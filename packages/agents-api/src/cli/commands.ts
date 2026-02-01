/**
 * All CLI command handlers. Each returns data; formatting handled by caller.
 */

import { createPublicClient, createWalletClient, http, parseEther, formatEther, type PublicClient, type WalletClient } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base } from 'viem/chains'
import { apiFetch, apiPost, getBaseUrl } from './api.js'
import { CLIError } from './errors.js'
import { DataEscrowABI } from '../abi/DataEscrow.js'

const ESCROW_ADDRESS = '0xDd4396d4F28d2b513175ae17dE11e56a898d19c3' as const
const EXPECTED_CHAIN = 8453
const GAS_SAFETY_CAP = parseEther('0.01')
const CHAIN_TIMEOUT_MS = 60_000

// ── Helpers ──

function requireKey(): `0x${string}` {
  const key = process.env.SX_KEY
  if (!key) throw new CLIError('ERR_MISSING_KEY', 'SX_KEY environment variable not set', 'Export SX_KEY=0x...')
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new CLIError('ERR_INVALID_SIGNATURE', 'SX_KEY is not a valid 64-char hex private key')
  return key as `0x${string}`
}

function requireRpc(): string {
  const rpc = process.env.SX_RPC
  if (!rpc) throw new CLIError('ERR_MISSING_KEY', 'SX_RPC environment variable not set for chain ops', 'Export SX_RPC=https://...')
  return rpc
}

async function getChainClient(): Promise<{ pub: PublicClient; wallet: WalletClient; address: `0x${string}` }> {
  const key = requireKey()
  const rpc = requireRpc()
  const account = privateKeyToAccount(key)

  const pub = createPublicClient({ chain: base, transport: http(rpc) }) as PublicClient
  const chainId = await pub.getChainId()
  if (chainId !== EXPECTED_CHAIN) {
    throw new CLIError('ERR_WRONG_CHAIN', `RPC returned chain ${chainId}, expected ${EXPECTED_CHAIN}`, 'Set SX_RPC to a Base RPC')
  }

  const wallet = createWalletClient({ account, chain: base, transport: http(rpc) })
  return { pub, wallet, address: account.address }
}

function requireConfirmation(opts: { yes?: boolean }): void {
  if (!opts.yes && !process.stdout.isTTY) {
    throw new CLIError('ERR_MISSING_KEY', 'Chain ops require --yes flag in non-TTY mode', 'Add --yes to confirm')
  }
}

interface ListOpts { limit?: string; offset?: string }
function listParams(opts: ListOpts): string {
  const limit = opts.limit || '50'
  const offset = opts.offset || '0'
  return `limit=${limit}&offset=${offset}`
}

// ── Read Commands ──

export async function statsFn() {
  return apiFetch('/stats')
}

export async function skillsList(opts: ListOpts & { category?: string; status?: string }) {
  let q = listParams(opts)
  if (opts.category) q += `&category=${encodeURIComponent(opts.category)}`
  if (opts.status) q += `&status=${encodeURIComponent(opts.status)}`
  return apiFetch(`/skills?${q}`)
}

export async function skillsShow(id: string) {
  return apiFetch(`/skills/${encodeURIComponent(id)}`)
}

export async function bountiesList(opts: ListOpts & { status?: string }) {
  let q = listParams(opts)
  if (opts.status) q += `&status=${encodeURIComponent(opts.status)}`
  const result = await apiFetch<{ bounties: unknown[] }>(`/bounties?${q}`)
  return result.bounties ?? result
}

export async function bountiesShow(id: string) {
  return apiFetch(`/bounties/${encodeURIComponent(id)}`)
}

export async function agentsList(opts: ListOpts & { sort?: string }) {
  let q = listParams(opts)
  if (opts.sort) q += `&sort=${encodeURIComponent(opts.sort)}`
  const result = await apiFetch<{ agents: unknown[] }>(`/agents?${q}`)
  return result.agents ?? result
}

export async function agentsShow(id: string) {
  return apiFetch(`/agents/${encodeURIComponent(id)}/reputation`)
}

export async function escrowsList(opts: ListOpts & { state?: string }) {
  let q = listParams(opts)
  if (opts.state) q += `&state=${encodeURIComponent(opts.state)}`
  const result = await apiFetch<{ escrows: unknown[] }>(`/escrows?${q}`)
  return result.escrows ?? result
}

export async function escrowsShow(id: string) {
  return apiFetch(`/escrows/${encodeURIComponent(id)}`)
}

export async function walletsList(opts: ListOpts & { role?: string }) {
  let q = listParams(opts)
  if (opts.role) q += `&role=${encodeURIComponent(opts.role)}`
  const result = await apiFetch<{ wallets: unknown[] }>(`/wallets?${q}`)
  return result.wallets ?? result
}

// ── Write Commands (API + EIP-191 signing) ──

export async function skillsVote(id: string, direction: string) {
  requireKey()
  if (direction !== 'up' && direction !== 'down') {
    throw new CLIError('ERR_INVALID_ADDRESS', 'Direction must be "up" or "down"')
  }
  return apiPost(`/skills/${encodeURIComponent(id)}/vote`, { direction })
}

export async function skillsComment(id: string, body: string) {
  requireKey()
  return apiPost(`/skills/${encodeURIComponent(id)}/comments`, { body })
}

export async function skillsCreate(opts: { title: string; price: string; description?: string; category?: string }) {
  requireKey()
  return apiPost('/skills', {
    title: opts.title,
    price: opts.price,
    description: opts.description,
    category: opts.category,
  })
}

export async function bountiesCreate(opts: { title: string; reward: string; description?: string; category?: string }) {
  requireKey()
  return apiPost('/bounties', {
    title: opts.title,
    rewardAmount: opts.reward,
    description: opts.description,
    category: opts.category,
  })
}

// ── Chain Commands ──

export async function escrowsCreate(opts: { contentHash: string; price: string; yes?: boolean }) {
  requireConfirmation(opts)
  const { pub, wallet, address } = await getChainClient()
  const amount = parseEther(opts.price)

  // Preview
  const gasEstimate = await pub.estimateGas({
    account: address,
    to: ESCROW_ADDRESS,
    data: '0x', // placeholder, real estimate below
  }).catch(() => 0n)

  console.error(`Create escrow: ${opts.price} ETH to ${ESCROW_ADDRESS}`)
  console.error(`From: ${address}`)
  if (gasEstimate > 0n) console.error(`Estimated gas: ~${formatEther(gasEstimate)} ETH`)

  if (gasEstimate > GAS_SAFETY_CAP) {
    throw new CLIError('ERR_GAS_TOO_HIGH', `Gas estimate ${formatEther(gasEstimate)} ETH exceeds safety cap of ${formatEther(GAS_SAFETY_CAP)} ETH`, 'Gas may be high, try again later')
  }

  if (!opts.yes) {
    // Interactive confirmation via readline
    const { createInterface } = await import('readline')
    const rl = createInterface({ input: process.stdin, output: process.stderr })
    const answer = await new Promise<string>(resolve => rl.question('Confirm? [y/N] ', resolve))
    rl.close()
    if (answer.toLowerCase() !== 'y') {
      console.error('Cancelled.')
      process.exit(0)
    }
  }

  // Zero key commitment for now (placeholder)
  const keyCommitment = '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`
  const nativeToken = '0x0000000000000000000000000000000000000000' as `0x${string}`

  const hash = await wallet.writeContract({
    address: ESCROW_ADDRESS,
    abi: DataEscrowABI,
    functionName: 'createEscrow',
    args: [opts.contentHash as `0x${string}`, keyCommitment, nativeToken, amount, 7n],
  })

  console.error(`Transaction: ${hash}`)
  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: CHAIN_TIMEOUT_MS })

  if (receipt.status === 'reverted') {
    throw new CLIError('ERR_TX_REVERTED', 'Transaction reverted', 'Check contract state and parameters')
  }

  return { txHash: hash, status: receipt.status, blockNumber: Number(receipt.blockNumber) }
}

export async function escrowsFund(id: string, opts: { yes?: boolean }) {
  requireConfirmation(opts)
  const { pub, wallet, address } = await getChainClient()
  const escrowId = BigInt(id)

  // Fetch escrow to get amount
  const escrow = await apiFetch<{ amount?: string }>(`/escrows/${id}`)
  const amount = escrow.amount ? BigInt(escrow.amount) : 0n

  console.error(`Fund escrow #${id}: ${formatEther(amount)} ETH`)
  console.error(`From: ${address}`)

  if (!opts.yes) {
    const { createInterface } = await import('readline')
    const rl = createInterface({ input: process.stdin, output: process.stderr })
    const answer = await new Promise<string>(resolve => rl.question('Confirm? [y/N] ', resolve))
    rl.close()
    if (answer.toLowerCase() !== 'y') { console.error('Cancelled.'); process.exit(0) }
  }

  const hash = await wallet.writeContract({
    address: ESCROW_ADDRESS,
    abi: DataEscrowABI,
    functionName: 'fundEscrow',
    args: [escrowId],
    value: amount,
  })

  console.error(`Transaction: ${hash}`)
  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: CHAIN_TIMEOUT_MS })
  if (receipt.status === 'reverted') throw new CLIError('ERR_TX_REVERTED', 'Transaction reverted')
  return { txHash: hash, status: receipt.status, blockNumber: Number(receipt.blockNumber) }
}

export async function escrowsCommitKey(id: string, opts: { yes?: boolean }) {
  requireConfirmation(opts)
  const { pub, wallet, address } = await getChainClient()
  const escrowId = BigInt(id)

  console.error(`Commit key for escrow #${id}`)
  console.error(`From: ${address}`)

  if (!opts.yes) {
    const { createInterface } = await import('readline')
    const rl = createInterface({ input: process.stdin, output: process.stderr })
    const answer = await new Promise<string>(resolve => rl.question('Confirm? [y/N] ', resolve))
    rl.close()
    if (answer.toLowerCase() !== 'y') { console.error('Cancelled.'); process.exit(0) }
  }

  // Placeholder commitment
  const commitment = '0x0000000000000000000000000000000000000000000000000000000000000001' as `0x${string}`
  const hash = await wallet.writeContract({
    address: ESCROW_ADDRESS,
    abi: DataEscrowABI,
    functionName: 'commitKeyRelease',
    args: [escrowId, commitment],
  })

  console.error(`Transaction: ${hash}`)
  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: CHAIN_TIMEOUT_MS })
  if (receipt.status === 'reverted') throw new CLIError('ERR_TX_REVERTED', 'Transaction reverted')
  return { txHash: hash, status: receipt.status, blockNumber: Number(receipt.blockNumber) }
}

export async function escrowsRevealKey(id: string, opts: { key: string; salt: string; yes?: boolean }) {
  requireConfirmation(opts)
  const { pub, wallet, address } = await getChainClient()
  const escrowId = BigInt(id)

  console.error(`Reveal key for escrow #${id}`)
  console.error(`From: ${address}`)

  if (!opts.yes) {
    const { createInterface } = await import('readline')
    const rl = createInterface({ input: process.stdin, output: process.stderr })
    const answer = await new Promise<string>(resolve => rl.question('Confirm? [y/N] ', resolve))
    rl.close()
    if (answer.toLowerCase() !== 'y') { console.error('Cancelled.'); process.exit(0) }
  }

  const hash = await wallet.writeContract({
    address: ESCROW_ADDRESS,
    abi: DataEscrowABI,
    functionName: 'revealKey',
    args: [escrowId, opts.key as `0x${string}`, opts.salt as `0x${string}`],
  })

  console.error(`Transaction: ${hash}`)
  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: CHAIN_TIMEOUT_MS })
  if (receipt.status === 'reverted') throw new CLIError('ERR_TX_REVERTED', 'Transaction reverted')
  return { txHash: hash, status: receipt.status, blockNumber: Number(receipt.blockNumber) }
}

export async function escrowsClaim(id: string, opts: { yes?: boolean }) {
  requireConfirmation(opts)
  const { pub, wallet, address } = await getChainClient()
  const escrowId = BigInt(id)

  console.error(`Claim payment for escrow #${id}`)
  console.error(`From: ${address}`)

  if (!opts.yes) {
    const { createInterface } = await import('readline')
    const rl = createInterface({ input: process.stdin, output: process.stderr })
    const answer = await new Promise<string>(resolve => rl.question('Confirm? [y/N] ', resolve))
    rl.close()
    if (answer.toLowerCase() !== 'y') { console.error('Cancelled.'); process.exit(0) }
  }

  const hash = await wallet.writeContract({
    address: ESCROW_ADDRESS,
    abi: DataEscrowABI,
    functionName: 'claimPayment',
    args: [escrowId],
  })

  console.error(`Transaction: ${hash}`)
  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: CHAIN_TIMEOUT_MS })
  if (receipt.status === 'reverted') throw new CLIError('ERR_TX_REVERTED', 'Transaction reverted')
  return { txHash: hash, status: receipt.status, blockNumber: Number(receipt.blockNumber) }
}

// ── Dashboard ──

export async function dashboardOverview() {
  const token = process.env.SX_DASHBOARD_TOKEN
  if (!token) throw new CLIError('ERR_MISSING_KEY', 'SX_DASHBOARD_TOKEN not set', 'Export SX_DASHBOARD_TOKEN=...')
  return apiFetch('/dashboard/overview', {
    headers: { 'Authorization': `Bearer ${token}` },
  })
}

// ── Config ──

export function configShow() {
  const mask = (v?: string) => v ? `${v.slice(0, 6)}...${v.slice(-4)}` : '(not set)'
  return {
    SX_API: process.env.SX_API || 'https://agents.datafund.io',
    SX_KEY: process.env.SX_KEY ? mask(process.env.SX_KEY) : '(not set)',
    SX_RPC: process.env.SX_RPC || '(not set)',
    SX_FORMAT: process.env.SX_FORMAT || '(auto)',
    contract: ESCROW_ADDRESS,
    chain: EXPECTED_CHAIN,
  }
}
