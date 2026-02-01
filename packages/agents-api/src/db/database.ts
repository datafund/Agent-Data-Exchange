/**
 * SQLite database wrapper
 */

import Database from 'better-sqlite3'
import { readFileSync } from 'fs'
import { mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export class AgentsDatabase {
  private db: Database.Database

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.init()
  }

  private init() {
    const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8')
    this.db.exec(schema)
  }

  // === Monitor State ===

  getLastBlock(chainId: number): bigint {
    const row = this.db.prepare('SELECT last_block FROM monitor_state WHERE chain_id = ?').get(chainId) as { last_block: number } | undefined
    return BigInt(row?.last_block ?? 0)
  }

  setLastBlock(chainId: number, block: bigint) {
    this.db.prepare(
      `INSERT INTO monitor_state (chain_id, last_block, last_updated)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(chain_id) DO UPDATE SET last_block = ?, last_updated = datetime('now')`
    ).run(chainId, Number(block), Number(block))
  }

  // === Escrow Events ===

  insertEvent(event: {
    chainId: number
    txHash: string
    logIndex: number
    blockNumber: number
    blockTimestamp: number
    escrowId: number
    eventType: string
    eventData: Record<string, unknown>
  }): boolean {
    try {
      this.db.prepare(
        `INSERT INTO escrow_events (chain_id, tx_hash, log_index, block_number, block_timestamp, escrow_id, event_type, event_data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        event.chainId, event.txHash, event.logIndex, event.blockNumber,
        event.blockTimestamp, event.escrowId, event.eventType,
        JSON.stringify(event.eventData)
      )
      return true
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') return false
      throw err
    }
  }

  // === Escrows ===

  upsertEscrow(escrow: {
    id: number
    chainId: number
    seller?: string
    buyer?: string
    paymentToken?: string
    sellerAgentId?: number
    buyerAgentId?: number
    amount?: string
    contentHash?: string
    disputeWindow?: number
    state?: string
    createdAt?: number
    fundedAt?: number | null
    committedAt?: number | null
    releasedAt?: number | null
    claimedAt?: number | null
    expiredAt?: number | null
    cancelledAt?: number | null
    disputedAt?: number | null
    resolvedAt?: number | null
    completed?: number
    disputed?: number
    disputeOutcome?: string | null
  }) {
    const existing = this.getEscrow(escrow.id)
    if (!existing) {
      this.db.prepare(
        `INSERT INTO escrows (id, chain_id, seller, buyer, payment_token, seller_agent_id, buyer_agent_id, amount, content_hash, dispute_window, state, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        escrow.id, escrow.chainId,
        escrow.seller ?? '', escrow.buyer ?? '', escrow.paymentToken ?? '',
        escrow.sellerAgentId ?? 0, escrow.buyerAgentId ?? 0,
        escrow.amount ?? '0', escrow.contentHash ?? '', escrow.disputeWindow ?? 0,
        escrow.state ?? 'created', escrow.createdAt ?? 0
      )
    }

    // Build dynamic update
    const updates: string[] = []
    const values: unknown[] = []

    const fields: [string, unknown, string][] = [
      ['buyer', escrow.buyer, 'buyer'],
      ['buyer_agent_id', escrow.buyerAgentId, 'buyerAgentId'],
      ['state', escrow.state, 'state'],
      ['funded_at', escrow.fundedAt, 'fundedAt'],
      ['committed_at', escrow.committedAt, 'committedAt'],
      ['released_at', escrow.releasedAt, 'releasedAt'],
      ['claimed_at', escrow.claimedAt, 'claimedAt'],
      ['expired_at', escrow.expiredAt, 'expiredAt'],
      ['cancelled_at', escrow.cancelledAt, 'cancelledAt'],
      ['disputed_at', escrow.disputedAt, 'disputedAt'],
      ['resolved_at', escrow.resolvedAt, 'resolvedAt'],
      ['completed', escrow.completed, 'completed'],
      ['disputed', escrow.disputed, 'disputed'],
      ['dispute_outcome', escrow.disputeOutcome, 'disputeOutcome'],
    ]

    for (const [col, val] of fields) {
      if (val !== undefined) {
        updates.push(`${col} = ?`)
        values.push(val)
      }
    }

    // Compute timing metrics
    if (escrow.fundedAt && existing?.created_at) {
      updates.push('time_to_fund = ?')
      values.push(escrow.fundedAt - existing.created_at)
    }
    if (escrow.releasedAt && existing?.funded_at) {
      updates.push('time_to_release = ?')
      values.push(escrow.releasedAt - existing.funded_at)
    }
    if (escrow.claimedAt && existing?.released_at) {
      updates.push('time_to_claim = ?')
      values.push(escrow.claimedAt - existing.released_at)
    }

    if (updates.length > 0) {
      updates.push("updated_at = datetime('now')")
      values.push(escrow.id)
      this.db.prepare(`UPDATE escrows SET ${updates.join(', ')} WHERE id = ?`).run(...values)
    }
  }

  getEscrow(id: number): EscrowRow | undefined {
    return this.db.prepare('SELECT * FROM escrows WHERE id = ?').get(id) as EscrowRow | undefined
  }

  listEscrows(opts: { seller?: string; buyer?: string; state?: string; limit?: number; offset?: number }): EscrowRow[] {
    const conditions: string[] = []
    const values: unknown[] = []

    if (opts.seller) { conditions.push('seller = ?'); values.push(opts.seller.toLowerCase()) }
    if (opts.buyer) { conditions.push('buyer = ?'); values.push(opts.buyer.toLowerCase()) }
    if (opts.state) { conditions.push('state = ?'); values.push(opts.state) }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const limit = opts.limit ?? 50
    const offset = opts.offset ?? 0

    return this.db.prepare(
      `SELECT * FROM escrows ${where} ORDER BY id DESC LIMIT ? OFFSET ?`
    ).all(...values, limit, offset) as EscrowRow[]
  }

  countEscrows(opts: { seller?: string; buyer?: string; state?: string }): number {
    const conditions: string[] = []
    const values: unknown[] = []

    if (opts.seller) { conditions.push('seller = ?'); values.push(opts.seller.toLowerCase()) }
    if (opts.buyer) { conditions.push('buyer = ?'); values.push(opts.buyer.toLowerCase()) }
    if (opts.state) { conditions.push('state = ?'); values.push(opts.state) }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const row = this.db.prepare(`SELECT COUNT(*) as count FROM escrows ${where}`).get(...values) as { count: number }
    return row.count
  }

  // === Agent Reputation ===

  getAgentReputation(agentId: number): AgentReputationRow | undefined {
    return this.db.prepare('SELECT * FROM agent_reputation WHERE agent_id = ?').get(agentId) as AgentReputationRow | undefined
  }

  upsertAgentReputation(rep: AgentReputationRow) {
    this.db.prepare(
      `INSERT INTO agent_reputation (agent_id, total_created, total_funded, total_completed, total_disputed, total_cancelled,
         total_volume, volume_30d, completion_rate, dispute_rate, cancellation_rate, reputation_score, first_escrow_at, last_escrow_at, last_updated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(agent_id) DO UPDATE SET
         total_created=?, total_funded=?, total_completed=?, total_disputed=?, total_cancelled=?,
         total_volume=?, volume_30d=?, completion_rate=?, dispute_rate=?, cancellation_rate=?,
         reputation_score=?, first_escrow_at=?, last_escrow_at=?, last_updated=datetime('now')`
    ).run(
      rep.agent_id, rep.total_created, rep.total_funded, rep.total_completed, rep.total_disputed, rep.total_cancelled,
      rep.total_volume, rep.volume_30d, rep.completion_rate, rep.dispute_rate, rep.cancellation_rate,
      rep.reputation_score, rep.first_escrow_at, rep.last_escrow_at,
      // UPDATE values
      rep.total_created, rep.total_funded, rep.total_completed, rep.total_disputed, rep.total_cancelled,
      rep.total_volume, rep.volume_30d, rep.completion_rate, rep.dispute_rate, rep.cancellation_rate,
      rep.reputation_score, rep.first_escrow_at, rep.last_escrow_at,
    )
  }

  // === Wallet Reputation ===

  getWalletReputation(address: string): { seller?: WalletReputationRow; buyer?: WalletReputationRow } {
    const addr = address.toLowerCase()
    const seller = this.db.prepare('SELECT * FROM wallet_reputation WHERE address = ? AND role = ?').get(addr, 'seller') as WalletReputationRow | undefined
    const buyer = this.db.prepare('SELECT * FROM wallet_reputation WHERE address = ? AND role = ?').get(addr, 'buyer') as WalletReputationRow | undefined
    return { seller, buyer }
  }

  upsertWalletReputation(rep: WalletReputationRow) {
    this.db.prepare(
      `INSERT INTO wallet_reputation (address, role, total_created, total_funded, total_completed, total_disputed, total_cancelled,
         total_volume, volume_30d, completion_rate, dispute_rate, cancellation_rate, reputation_score,
         avg_delivery_seconds, first_escrow_at, last_escrow_at, last_updated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(address, role) DO UPDATE SET
         total_created=?, total_funded=?, total_completed=?, total_disputed=?, total_cancelled=?,
         total_volume=?, volume_30d=?, completion_rate=?, dispute_rate=?, cancellation_rate=?,
         reputation_score=?, avg_delivery_seconds=?, first_escrow_at=?, last_escrow_at=?, last_updated=datetime('now')`
    ).run(
      rep.address, rep.role,
      rep.total_created, rep.total_funded, rep.total_completed, rep.total_disputed, rep.total_cancelled,
      rep.total_volume, rep.volume_30d, rep.completion_rate, rep.dispute_rate, rep.cancellation_rate,
      rep.reputation_score, rep.avg_delivery_seconds, rep.first_escrow_at, rep.last_escrow_at,
      // UPDATE
      rep.total_created, rep.total_funded, rep.total_completed, rep.total_disputed, rep.total_cancelled,
      rep.total_volume, rep.volume_30d, rep.completion_rate, rep.dispute_rate, rep.cancellation_rate,
      rep.reputation_score, rep.avg_delivery_seconds, rep.first_escrow_at, rep.last_escrow_at,
    )
  }

  // === Protocol Stats ===

  getProtocolStats(): ProtocolStatsRow {
    return this.db.prepare('SELECT * FROM protocol_stats WHERE id = 1').get() as ProtocolStatsRow
  }

  updateProtocolStats() {
    this.db.prepare(`
      UPDATE protocol_stats SET
        total_escrows = (SELECT COUNT(*) FROM escrows),
        total_funded = (SELECT COUNT(*) FROM escrows WHERE funded_at IS NOT NULL),
        total_completed = (SELECT COUNT(*) FROM escrows WHERE completed = 1),
        total_disputed = (SELECT COUNT(*) FROM escrows WHERE disputed = 1),
        unique_sellers = (SELECT COUNT(DISTINCT seller) FROM escrows WHERE seller != ''),
        unique_buyers = (SELECT COUNT(DISTINCT buyer) FROM escrows WHERE buyer != ''),
        unique_agents = (SELECT COUNT(*) FROM agent_reputation),
        total_bounties = (SELECT COUNT(*) FROM bounties),
        total_bounties_fulfilled = (SELECT COUNT(*) FROM bounties WHERE status = 'fulfilled'),
        last_updated = datetime('now')
      WHERE id = 1
    `).run()
  }

  // === Directory listings ===

  listAgentReputations(opts: { limit?: number; offset?: number } = {}): AgentReputationRow[] {
    const limit = Math.min(opts.limit ?? 50, 100)
    const offset = opts.offset ?? 0
    return this.db.prepare(
      'SELECT * FROM agent_reputation ORDER BY reputation_score DESC LIMIT ? OFFSET ?'
    ).all(limit, offset) as AgentReputationRow[]
  }

  countAgentReputations(): number {
    return (this.db.prepare('SELECT COUNT(*) as count FROM agent_reputation').get() as { count: number }).count
  }

  listWalletReputations(opts: { role?: string; limit?: number; offset?: number } = {}): WalletReputationRow[] {
    const limit = Math.min(opts.limit ?? 50, 100)
    const offset = opts.offset ?? 0
    if (opts.role) {
      return this.db.prepare(
        'SELECT * FROM wallet_reputation WHERE role = ? ORDER BY reputation_score DESC LIMIT ? OFFSET ?'
      ).all(opts.role, limit, offset) as WalletReputationRow[]
    }
    return this.db.prepare(
      'SELECT * FROM wallet_reputation ORDER BY reputation_score DESC LIMIT ? OFFSET ?'
    ).all(limit, offset) as WalletReputationRow[]
  }

  countWalletReputations(role?: string): number {
    if (role) {
      return (this.db.prepare('SELECT COUNT(*) as count FROM wallet_reputation WHERE role = ?').get(role) as { count: number }).count
    }
    return (this.db.prepare('SELECT COUNT(*) as count FROM wallet_reputation').get() as { count: number }).count
  }

  // === Aggregation queries for reputation calculation ===

  getAgentEscrowStats(agentId: number): {
    asSellerCreated: number; asSellerCompleted: number; asSellerDisputed: number; asSellerCancelled: number;
    asBuyerFunded: number; asBuyerCompleted: number; asBuyerDisputed: number;
    totalVolume: string; avgDeliverySeconds: number | null;
    firstEscrowAt: number | null; lastEscrowAt: number | null;
  } {
    const seller = this.db.prepare(`
      SELECT COUNT(*) as cnt, SUM(CASE WHEN completed=1 THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN disputed=1 THEN 1 ELSE 0 END) as disputed,
        SUM(CASE WHEN state='cancelled' THEN 1 ELSE 0 END) as cancelled,
        COALESCE(SUM(CAST(amount AS INTEGER)), 0) as vol,
        AVG(CASE WHEN time_to_release IS NOT NULL THEN time_to_release END) as avg_delivery,
        MIN(created_at) as first_at, MAX(created_at) as last_at
      FROM escrows WHERE seller_agent_id = ?
    `).get(agentId) as Record<string, number | null>

    const buyer = this.db.prepare(`
      SELECT COUNT(*) as cnt, SUM(CASE WHEN completed=1 THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN disputed=1 THEN 1 ELSE 0 END) as disputed
      FROM escrows WHERE buyer_agent_id = ?
    `).get(agentId) as Record<string, number | null>

    return {
      asSellerCreated: (seller.cnt ?? 0) as number,
      asSellerCompleted: (seller.completed ?? 0) as number,
      asSellerDisputed: (seller.disputed ?? 0) as number,
      asSellerCancelled: (seller.cancelled ?? 0) as number,
      asBuyerFunded: (buyer.cnt ?? 0) as number,
      asBuyerCompleted: (buyer.completed ?? 0) as number,
      asBuyerDisputed: (buyer.disputed ?? 0) as number,
      totalVolume: String(seller.vol ?? 0),
      avgDeliverySeconds: seller.avg_delivery as number | null,
      firstEscrowAt: seller.first_at as number | null,
      lastEscrowAt: seller.last_at as number | null,
    }
  }

  getWalletEscrowStats(address: string, role: 'seller' | 'buyer'): {
    total: number; completed: number; disputed: number; cancelled: number;
    totalVolume: string; avgDeliverySeconds: number | null;
    firstEscrowAt: number | null; lastEscrowAt: number | null;
  } {
    const col = role === 'seller' ? 'seller' : 'buyer'
    const row = this.db.prepare(`
      SELECT COUNT(*) as cnt, SUM(CASE WHEN completed=1 THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN disputed=1 THEN 1 ELSE 0 END) as disputed,
        SUM(CASE WHEN state='cancelled' THEN 1 ELSE 0 END) as cancelled,
        COALESCE(SUM(CAST(amount AS INTEGER)), 0) as vol,
        AVG(CASE WHEN time_to_release IS NOT NULL THEN time_to_release END) as avg_delivery,
        MIN(created_at) as first_at, MAX(created_at) as last_at
      FROM escrows WHERE ${col} = ?
    `).get(address.toLowerCase()) as Record<string, number | null>

    return {
      total: (row.cnt ?? 0) as number,
      completed: (row.completed ?? 0) as number,
      disputed: (row.disputed ?? 0) as number,
      cancelled: (row.cancelled ?? 0) as number,
      totalVolume: String(row.vol ?? 0),
      avgDeliverySeconds: row.avg_delivery as number | null,
      firstEscrowAt: row.first_at as number | null,
      lastEscrowAt: row.last_at as number | null,
    }
  }

  getEscrowsByAgent(agentId: number, opts: { limit?: number; offset?: number }): EscrowRow[] {
    return this.db.prepare(
      `SELECT * FROM escrows WHERE seller_agent_id = ? OR buyer_agent_id = ? ORDER BY id DESC LIMIT ? OFFSET ?`
    ).all(agentId, agentId, opts.limit ?? 50, opts.offset ?? 0) as EscrowRow[]
  }

  countEscrowsByAgent(agentId: number): number {
    const row = this.db.prepare(
      `SELECT COUNT(*) as count FROM escrows WHERE seller_agent_id = ? OR buyer_agent_id = ?`
    ).get(agentId, agentId) as { count: number }
    return row.count
  }

  getEscrowsByWallet(address: string, opts: { limit?: number; offset?: number }): EscrowRow[] {
    const addr = address.toLowerCase()
    return this.db.prepare(
      `SELECT * FROM escrows WHERE seller = ? OR buyer = ? ORDER BY id DESC LIMIT ? OFFSET ?`
    ).all(addr, addr, opts.limit ?? 50, opts.offset ?? 0) as EscrowRow[]
  }

  countEscrowsByWallet(address: string): number {
    const addr = address.toLowerCase()
    const row = this.db.prepare(
      `SELECT COUNT(*) as count FROM escrows WHERE seller = ? OR buyer = ?`
    ).get(addr, addr) as { count: number }
    return row.count
  }

  // === Bounties ===

  createBounty(bounty: {
    id: string
    poster: string
    posterAgentId?: number
    title: string
    description?: string
    category?: string
    rewardAmount?: string
    rewardToken?: string
    tags?: string[]
    moltbookPostId?: string
    createdAt: number
    expiresAt: number
  }): boolean {
    try {
      this.db.prepare(
        `INSERT INTO bounties (id, poster, poster_agent_id, title, description, category, reward_amount, reward_token, tags, moltbook_post_id, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        bounty.id, bounty.poster.toLowerCase(), bounty.posterAgentId ?? 0,
        bounty.title, bounty.description ?? '', bounty.category ?? '',
        bounty.rewardAmount ?? '0', bounty.rewardToken ?? 'USDC',
        JSON.stringify(bounty.tags ?? []), bounty.moltbookPostId ?? null,
        bounty.createdAt, bounty.expiresAt,
      )
      return true
    } catch {
      return false
    }
  }

  getBounty(id: string): BountyRow | undefined {
    return this.db.prepare('SELECT * FROM bounties WHERE id = ?').get(id) as BountyRow | undefined
  }

  listBounties(opts: { poster?: string; category?: string; status?: string; limit?: number; offset?: number }): BountyRow[] {
    const conditions: string[] = []
    const values: unknown[] = []

    if (opts.poster) { conditions.push('poster = ?'); values.push(opts.poster.toLowerCase()) }
    if (opts.category) { conditions.push('category = ?'); values.push(opts.category) }
    if (opts.status) { conditions.push('status = ?'); values.push(opts.status) }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    return this.db.prepare(
      `SELECT * FROM bounties ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(...values, opts.limit ?? 50, opts.offset ?? 0) as BountyRow[]
  }

  countBounties(opts: { poster?: string; status?: string }): number {
    const conditions: string[] = []
    const values: unknown[] = []

    if (opts.poster) { conditions.push('poster = ?'); values.push(opts.poster.toLowerCase()) }
    if (opts.status) { conditions.push('status = ?'); values.push(opts.status) }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const row = this.db.prepare(`SELECT COUNT(*) as count FROM bounties ${where}`).get(...values) as { count: number }
    return row.count
  }

  fulfillBounty(id: string, escrowId: number) {
    this.db.prepare(
      `UPDATE bounties SET status = 'fulfilled', escrow_id = ?, fulfilled_at = ? WHERE id = ?`
    ).run(escrowId, Math.floor(Date.now() / 1000), id)
  }

  cancelBounty(id: string) {
    this.db.prepare(
      `UPDATE bounties SET status = 'cancelled', cancelled_at = ? WHERE id = ?`
    ).run(Math.floor(Date.now() / 1000), id)
  }

  expireOldBounties() {
    const now = Math.floor(Date.now() / 1000)
    this.db.prepare(
      `UPDATE bounties SET status = 'expired' WHERE status = 'open' AND expires_at < ?`
    ).run(now)
  }

  getBountyStatsForWallet(address: string): { total: number; fulfilled: number; expired: number; cancelled: number } {
    const row = this.db.prepare(`
      SELECT COUNT(*) as total,
        SUM(CASE WHEN status='fulfilled' THEN 1 ELSE 0 END) as fulfilled,
        SUM(CASE WHEN status='expired' THEN 1 ELSE 0 END) as expired,
        SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) as cancelled
      FROM bounties WHERE poster = ?
    `).get(address.toLowerCase()) as Record<string, number>
    return {
      total: row.total ?? 0,
      fulfilled: row.fulfilled ?? 0,
      expired: row.expired ?? 0,
      cancelled: row.cancelled ?? 0,
    }
  }

  close() {
    this.db.close()
  }
}

// Row types
export interface EscrowRow {
  id: number
  chain_id: number
  seller: string
  buyer: string
  payment_token: string
  seller_agent_id: number
  buyer_agent_id: number
  amount: string
  content_hash: string
  dispute_window: number
  state: string
  created_at: number
  funded_at: number | null
  committed_at: number | null
  released_at: number | null
  claimed_at: number | null
  expired_at: number | null
  cancelled_at: number | null
  disputed_at: number | null
  resolved_at: number | null
  time_to_fund: number | null
  time_to_release: number | null
  time_to_claim: number | null
  completed: number
  disputed: number
  dispute_outcome: string | null
}

export interface AgentReputationRow {
  agent_id: number
  total_created: number
  total_funded: number
  total_completed: number
  total_disputed: number
  total_cancelled: number
  total_volume: string
  volume_30d: string
  completion_rate: number
  dispute_rate: number
  cancellation_rate: number
  reputation_score: number
  first_escrow_at: number | null
  last_escrow_at: number | null
}

export interface WalletReputationRow {
  address: string
  role: string
  total_created: number
  total_funded: number
  total_completed: number
  total_disputed: number
  total_cancelled: number
  total_volume: string
  volume_30d: string
  completion_rate: number
  dispute_rate: number
  cancellation_rate: number
  reputation_score: number
  avg_delivery_seconds: number | null
  first_escrow_at: number | null
  last_escrow_at: number | null
}

export interface BountyRow {
  id: string
  poster: string
  poster_agent_id: number
  title: string
  description: string
  category: string
  reward_amount: string
  reward_token: string
  tags: string
  status: string
  escrow_id: number | null
  moltbook_post_id: string | null
  created_at: number
  expires_at: number
  fulfilled_at: number | null
  cancelled_at: number | null
}

export interface ProtocolStatsRow {
  total_escrows: number
  total_funded: number
  total_completed: number
  total_disputed: number
  total_volume: string
  volume_30d: string
  unique_sellers: number
  unique_buyers: number
  unique_agents: number
  total_bounties: number
  total_bounties_fulfilled: number
}
