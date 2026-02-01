/**
 * Escrow Event Indexer
 *
 * Polls DataEscrowV3 contract events and updates the database.
 * Follows the payment-monitor pattern: poll interval, catch-up batches, idempotent inserts.
 */

import { createPublicClient, http, type PublicClient, type Log, decodeEventLog } from 'viem'
import { base, sepolia } from 'viem/chains'
import { DataEscrowABI } from '../abi/DataEscrow.js'
import type { ChainConfig } from '../config.js'
import type { AgentsDatabase } from '../db/database.js'
import { ReputationCalculator } from '../reputation/calculator.js'

const CHAIN_MAP: Record<number, typeof base> = {
  8453: base,
  11155111: sepolia,
}

// Event names we care about
const EVENT_NAMES = [
  'EscrowCreated', 'EscrowFunded', 'EscrowCancelled', 'EscrowExpired',
  'KeyCommitted', 'KeyRevealed', 'PaymentClaimed',
  'DisputeRaised', 'SellerResponded', 'DisputeResolved', 'EmergencyWithdrawal',
] as const

export class EscrowIndexer {
  private clients: Map<number, PublicClient> = new Map()
  private intervals: Map<number, ReturnType<typeof setInterval>> = new Map()
  private db: AgentsDatabase
  private calculator: ReputationCalculator
  private pollIntervalMs: number
  private catchupBatchSize: number
  private chains: ChainConfig[]
  private running = false
  private lastPollAt: number | null = null

  constructor(
    db: AgentsDatabase,
    chains: ChainConfig[],
    pollIntervalMs: number,
    catchupBatchSize: number,
  ) {
    this.db = db
    this.calculator = new ReputationCalculator(db)
    this.chains = chains
    this.pollIntervalMs = pollIntervalMs
    this.catchupBatchSize = catchupBatchSize

    for (const chain of chains) {
      const viemChain = CHAIN_MAP[chain.chainId]
      const client = createPublicClient({
        chain: viemChain,
        transport: http(chain.rpcUrl),
      })
      this.clients.set(chain.chainId, client)
    }
  }

  async start() {
    this.running = true
    console.log(`[indexer] Starting indexer for ${this.chains.length} chain(s)`)

    // Catch up on each chain first
    for (const chain of this.chains) {
      await this.catchUp(chain)
    }

    // Start polling
    for (const chain of this.chains) {
      const interval = setInterval(() => this.pollChain(chain), this.pollIntervalMs)
      this.intervals.set(chain.chainId, interval)
      console.log(`[indexer] Polling ${chain.name} every ${this.pollIntervalMs}ms`)
    }
  }

  stop() {
    this.running = false
    for (const [chainId, interval] of this.intervals) {
      clearInterval(interval)
      console.log(`[indexer] Stopped polling chain ${chainId}`)
    }
    this.intervals.clear()
  }

  private async catchUp(chain: ChainConfig) {
    const client = this.clients.get(chain.chainId)!
    let lastBlock = this.db.getLastBlock(chain.chainId)
    const startBlock = lastBlock > 0n ? lastBlock + 1n : chain.startBlock

    const currentBlock = await client.getBlockNumber()
    const safeBlock = currentBlock - BigInt(chain.confirmations)

    if (startBlock >= safeBlock) {
      console.log(`[indexer] ${chain.name}: already up to date at block ${lastBlock}`)
      return
    }

    console.log(`[indexer] ${chain.name}: catching up from ${startBlock} to ${safeBlock} (${safeBlock - startBlock} blocks)`)

    let from = startBlock
    while (from <= safeBlock && this.running) {
      const to = from + BigInt(this.catchupBatchSize) - 1n > safeBlock
        ? safeBlock
        : from + BigInt(this.catchupBatchSize) - 1n

      await this.fetchAndProcessEvents(chain, from, to)
      this.db.setLastBlock(chain.chainId, to)
      from = to + 1n
    }
  }

  private async pollChain(chain: ChainConfig) {
    this.lastPollAt = Date.now()
    try {
      const client = this.clients.get(chain.chainId)!
      const currentBlock = await client.getBlockNumber()
      const safeBlock = currentBlock - BigInt(chain.confirmations)
      const lastBlock = this.db.getLastBlock(chain.chainId)
      const fromBlock = lastBlock > 0n ? lastBlock + 1n : chain.startBlock

      if (fromBlock > safeBlock) return

      await this.fetchAndProcessEvents(chain, fromBlock, safeBlock)
      this.db.setLastBlock(chain.chainId, safeBlock)
    } catch (err) {
      console.error(`[indexer] ${chain.name}: poll error:`, err)
    }
  }

  private async fetchAndProcessEvents(chain: ChainConfig, fromBlock: bigint, toBlock: bigint) {
    const client = this.clients.get(chain.chainId)!

    // Use getLogs without topic filters to avoid Alchemy's topic complexity limits.
    // Decode events client-side from the full ABI.
    const rawLogs = await client.getLogs({
      address: chain.escrowContract,
      fromBlock,
      toBlock,
    })

    // Decode each log against the ABI
    const logs: Array<Log & { eventName?: string; args?: Record<string, unknown> }> = []
    for (const raw of rawLogs) {
      try {
        const decoded = decodeEventLog({ abi: DataEscrowABI, data: raw.data, topics: raw.topics })
        logs.push({ ...raw, eventName: decoded.eventName, args: decoded.args as Record<string, unknown> })
      } catch {
        // Unknown event (e.g. proxy/OZ events) — skip
      }
    }

    if (logs.length > 0) {
      console.log(`[indexer] ${chain.name}: ${logs.length} events in blocks ${fromBlock}-${toBlock}`)
    }

    // We need block timestamps. Batch unique blocks.
    const blockTimestamps = new Map<bigint, number>()
    const uniqueBlocks = [...new Set(logs.map(l => l.blockNumber))]
    for (const bn of uniqueBlocks) {
      if (bn === null) continue
      const block = await client.getBlock({ blockNumber: bn })
      blockTimestamps.set(bn, Number(block.timestamp))
    }

    const affectedAgents = new Set<number>()
    const affectedWallets = new Set<string>()

    for (const log of logs) {
      const processed = this.processLog(log, chain.chainId, blockTimestamps)
      if (processed) {
        const { agents, wallets } = processed
        agents.forEach(a => affectedAgents.add(a))
        wallets.forEach(w => affectedWallets.add(w))
      }
    }

    // Recalculate reputation for affected entities
    for (const agentId of affectedAgents) {
      if (agentId > 0) this.calculator.recalculateAgent(agentId)
    }
    for (const wallet of affectedWallets) {
      this.calculator.recalculateWallet(wallet)
    }

    if (affectedAgents.size > 0 || affectedWallets.size > 0) {
      this.db.updateProtocolStats()
    }
  }

  private processLog(
    log: Log & { eventName?: string; args?: Record<string, unknown> },
    chainId: number,
    blockTimestamps: Map<bigint, number>,
  ): { agents: number[]; wallets: string[] } | null {
    if (!log.eventName || !log.blockNumber || !log.transactionHash) return null

    const blockTimestamp = blockTimestamps.get(log.blockNumber) ?? 0
    const args = (log.args ?? {}) as Record<string, unknown>
    const escrowId = Number(args.escrowId ?? 0)

    if (escrowId === 0) return null

    const eventType = this.eventNameToType(log.eventName)
    if (!eventType) return null

    // Insert raw event
    const inserted = this.db.insertEvent({
      chainId,
      txHash: log.transactionHash,
      logIndex: log.logIndex ?? 0,
      blockNumber: Number(log.blockNumber),
      blockTimestamp,
      escrowId,
      eventType,
      eventData: args as Record<string, unknown>,
    })

    if (!inserted) return null // duplicate

    const agents: number[] = []
    const wallets: string[] = []

    // Update escrow state
    switch (log.eventName) {
      case 'EscrowCreated': {
        const seller = String(args.seller ?? '').toLowerCase()
        const sellerAgentId = Number(args.sellerAgentId ?? 0)
        this.db.upsertEscrow({
          id: escrowId,
          chainId,
          seller,
          paymentToken: String(args.paymentToken ?? ''),
          contentHash: String(args.contentHash ?? ''),
          amount: String(args.amount ?? '0'),
          disputeWindow: Number(args.disputeWindow ?? 0),
          sellerAgentId,
          state: 'created',
          createdAt: blockTimestamp,
        })
        wallets.push(seller)
        agents.push(sellerAgentId)
        break
      }
      case 'EscrowFunded': {
        const buyer = String(args.buyer ?? '').toLowerCase()
        const buyerAgentId = Number(args.buyerAgentId ?? 0)
        this.db.upsertEscrow({
          id: escrowId,
          chainId,
          buyer,
          buyerAgentId,
          state: 'funded',
          fundedAt: blockTimestamp,
        })
        wallets.push(buyer)
        agents.push(buyerAgentId)
        // Also add seller from existing record
        const funded = this.db.getEscrow(escrowId)
        if (funded) {
          wallets.push(funded.seller)
          agents.push(funded.seller_agent_id)
        }
        break
      }
      case 'EscrowCancelled': {
        this.db.upsertEscrow({ id: escrowId, chainId, state: 'cancelled', cancelledAt: blockTimestamp })
        const cancelled = this.db.getEscrow(escrowId)
        if (cancelled) {
          wallets.push(cancelled.seller)
          agents.push(cancelled.seller_agent_id)
        }
        break
      }
      case 'KeyCommitted': {
        this.db.upsertEscrow({ id: escrowId, chainId, state: 'key_committed', committedAt: blockTimestamp })
        break
      }
      case 'KeyRevealed': {
        this.db.upsertEscrow({ id: escrowId, chainId, state: 'released', releasedAt: blockTimestamp })
        break
      }
      case 'PaymentClaimed': {
        this.db.upsertEscrow({ id: escrowId, chainId, state: 'claimed', claimedAt: blockTimestamp, completed: 1 })
        const claimed = this.db.getEscrow(escrowId)
        if (claimed) {
          wallets.push(claimed.seller, claimed.buyer)
          agents.push(claimed.seller_agent_id, claimed.buyer_agent_id)
        }
        break
      }
      case 'EscrowExpired': {
        this.db.upsertEscrow({ id: escrowId, chainId, state: 'expired', expiredAt: blockTimestamp })
        const expired = this.db.getEscrow(escrowId)
        if (expired) {
          wallets.push(expired.buyer)
          agents.push(expired.buyer_agent_id)
        }
        break
      }
      case 'DisputeRaised': {
        this.db.upsertEscrow({ id: escrowId, chainId, state: 'disputed', disputedAt: blockTimestamp, disputed: 1 })
        const disputed = this.db.getEscrow(escrowId)
        if (disputed) {
          wallets.push(disputed.seller, disputed.buyer)
          agents.push(disputed.seller_agent_id, disputed.buyer_agent_id)
        }
        break
      }
      case 'SellerResponded': {
        this.db.upsertEscrow({ id: escrowId, chainId, state: 'seller_responded' })
        break
      }
      case 'DisputeResolved': {
        const sellerWins = Boolean(args.sellerWins)
        this.db.upsertEscrow({
          id: escrowId,
          chainId,
          state: sellerWins ? 'resolved_seller' : 'resolved_buyer',
          resolvedAt: blockTimestamp,
          disputeOutcome: sellerWins ? 'seller_wins' : 'buyer_wins',
          completed: sellerWins ? 1 : 0,
        })
        const resolved = this.db.getEscrow(escrowId)
        if (resolved) {
          wallets.push(resolved.seller, resolved.buyer)
          agents.push(resolved.seller_agent_id, resolved.buyer_agent_id)
        }
        break
      }
      case 'EmergencyWithdrawal': {
        this.db.upsertEscrow({ id: escrowId, chainId, state: 'expired', expiredAt: blockTimestamp })
        break
      }
    }

    return { agents, wallets }
  }

  private eventNameToType(eventName: string): string | null {
    const map: Record<string, string> = {
      EscrowCreated: 'created',
      EscrowFunded: 'funded',
      EscrowCancelled: 'cancelled',
      EscrowExpired: 'expired',
      KeyCommitted: 'key_committed',
      KeyRevealed: 'key_revealed',
      PaymentClaimed: 'claimed',
      DisputeRaised: 'dispute_raised',
      SellerResponded: 'seller_responded',
      DisputeResolved: 'dispute_resolved',
      EmergencyWithdrawal: 'emergency_withdrawal',
    }
    return map[eventName] ?? null
  }

  getStatus(): {
    running: boolean
    chains: Array<{ chainId: number; name: string; lastBlock: string }>
    lastPollAt: number | null
    pollIntervalMs: number
  } {
    return {
      running: this.running,
      chains: this.chains.map(c => ({
        chainId: c.chainId,
        name: c.name,
        lastBlock: this.db.getLastBlock(c.chainId).toString(),
      })),
      lastPollAt: this.lastPollAt,
      pollIntervalMs: this.pollIntervalMs,
    }
  }
}
