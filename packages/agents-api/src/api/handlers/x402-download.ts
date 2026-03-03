import type { Request, Response } from 'express'
import type { AgentsDatabase } from '../../db/database.js'
import * as crypto from 'crypto'
import { type PublicClient, type WalletClient, type Hex, keccak256, toBytes, createPublicClient, createWalletClient, http } from 'viem'
import { base } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'

// --- Inlined from @fairdrop/agent-exchange-sdk/src/x402.ts — keep in sync ---

function decryptContentKey(encrypted: string, masterSecretHex: string): string {
  const master = Buffer.from(masterSecretHex, 'hex')
  const buf = Buffer.from(encrypted, 'base64')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const ct = buf.subarray(28)
  const decipher = crypto.createDecipheriv('aes-256-gcm', master, iv)
  decipher.setAuthTag(tag)
  return decipher.update(ct).toString('utf8') + decipher.final('utf8')
}

function decryptContent(encrypted: Buffer, keyHex: string): Buffer {
  const key = Buffer.from(keyHex, 'hex')
  const iv = encrypted.subarray(0, 12)
  const authTag = encrypted.subarray(12, 28)
  const ciphertext = encrypted.subarray(28)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+/, '')
    .trim()
  return cleaned || 'download'
}

function isValidSwarmRef(ref: string): boolean {
  return /^[0-9a-f]{64}$/i.test(ref)
}

// --- Inlined PaymentProxyClient (from packages/contracts/src/PaymentProxy.ts) — keep in sync ---

const PAYMENT_PROXY_ABI = [
  {
    name: 'forward',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'seller', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'skillId', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    name: 'feeBps',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint16' }],
  },
] as const

class PaymentProxyClient {
  constructor(
    private address: Hex,
    private pub: PublicClient,
    private wallet?: WalletClient,
  ) {}

  async forward(seller: Hex, token: Hex, amount: bigint, skillId: string): Promise<Hex> {
    if (!this.wallet?.account) throw new Error('Wallet required for forward()')
    const skillIdBytes32 = keccak256(toBytes(skillId))
    const { request } = await this.pub.simulateContract({
      address: this.address,
      abi: PAYMENT_PROXY_ABI,
      functionName: 'forward',
      args: [seller, token, amount, skillIdBytes32],
      account: this.wallet.account,
    })
    return this.wallet.writeContract(request)
  }
}

// --- End inlined code ---

// Constants
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const BASE_NETWORK = 'eip155:8453'

// === Configuration (validated at startup — see Task 4b Step 3) ===

const FACILITATOR_URL = process.env.X402_FACILITATOR_URL || 'https://x402.org/facilitator'
const PAYMENT_PROXY = process.env.PAYMENT_PROXY_ADDRESS || ''
const RELAYER_KEY = process.env.RELAYER_KEY || ''
const CONTENT_KEY_SECRET = process.env.X402_CONTENT_KEY_SECRET || ''
const SWARM_GATEWAY = process.env.SWARM_GATEWAY_URL || 'https://bee.fairdrop.xyz'

// === Facilitator client ===

interface SettlementResult {
  success: boolean
  txHash?: string
  buyerAddress?: string
  settledAmount?: string
  error?: string
}

async function verifyAndSettle(paymentHeader: string, expectedAmount: string): Promise<SettlementResult> {
  try {
    const res = await fetch(`${FACILITATOR_URL}/settle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payment: paymentHeader }),
    })
    if (!res.ok) {
      return { success: false, error: `Facilitator: ${res.status}` }
    }
    const data = await res.json() as any
    const txHash = data.txHash || data.transaction?.hash
    const buyerAddress = data.payerAddress || data.from
    const settledAmount = data.amount || data.value

    if (!txHash || !/^0x[0-9a-f]{64}$/i.test(txHash)) {
      return { success: false, error: 'Invalid txHash format from facilitator' }
    }
    if (!buyerAddress) {
      return { success: false, error: 'No buyer address from facilitator' }
    }
    if (!settledAmount) {
      return { success: false, error: 'Facilitator did not return settled amount — cannot verify payment' }
    }
    if (BigInt(settledAmount) < BigInt(expectedAmount)) {
      return { success: false, error: `Underpayment: settled ${settledAmount} but skill costs ${expectedAmount}` }
    }

    return { success: true, txHash, buyerAddress, settledAmount }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

function create402Response(skillId: string, price: string, seller: string, resource: string) {
  return {
    x402Version: 2,
    paymentRequirements: [{
      scheme: 'exact',
      network: BASE_NETWORK,
      maxAmountRequired: price,
      resource,
      description: `Purchase skill: ${skillId}`,
      payTo: PAYMENT_PROXY,
      asset: USDC_BASE,
      extra: { seller, skillId },
    }],
  }
}

// === Proxy forward ===

let proxyClient: PaymentProxyClient | null = null

function getProxyClient(): PaymentProxyClient | null {
  if (proxyClient) return proxyClient
  if (!PAYMENT_PROXY || !RELAYER_KEY) return null
  const pub = createPublicClient({ chain: base, transport: http() })
  const account = privateKeyToAccount(RELAYER_KEY as `0x${string}`)
  const wallet = createWalletClient({ chain: base, transport: http(), account })
  proxyClient = new PaymentProxyClient(PAYMENT_PROXY as `0x${string}`, pub as PublicClient, wallet as WalletClient)
  return proxyClient
}

async function forwardPaymentToSeller(
  db: AgentsDatabase, seller: string, amount: string, skillId: string, paymentId: string
): Promise<void> {
  db.recordPendingForward({ paymentId, skillId, seller, amount })

  const client = getProxyClient()
  if (!client) {
    console.error('[x402] No proxy client configured — forward stays pending in DB')
    return
  }
  try {
    const txHash = await client.forward(
      seller as `0x${string}`, USDC_BASE as `0x${string}`, BigInt(amount), skillId
    )
    db.updatePendingForward(paymentId, 'completed', txHash)
    console.error(`[x402] Forwarded ${amount} USDC to ${seller}: ${txHash}`)
  } catch (err) {
    db.updatePendingForward(paymentId, 'failed', undefined)
    console.error(`[x402] Forward failed for skill ${skillId} seller ${seller}:`, err)
  }
}

// === Shared: fetch and decrypt content from Swarm ===

async function fetchAndDecryptContent(
  swarmRef: string, encryptedKey: string | null, contentKeySecret: string
): Promise<{ content: Buffer } | { error: string; status: number }> {
  if (!isValidSwarmRef(swarmRef)) {
    return { error: 'Invalid Swarm reference', status: 500 }
  }
  const swarmUrl = (SWARM_GATEWAY).replace(/\/+$/, '')
  let swarmRes: Response
  try {
    swarmRes = await fetch(`${swarmUrl}/bytes/${swarmRef}`)
  } catch (err) {
    return { error: 'Failed to fetch content from Swarm', status: 502 }
  }
  if (!swarmRes.ok) {
    return { error: 'Failed to fetch content from Swarm', status: 502 }
  }
  let content: Buffer = Buffer.from(await swarmRes.arrayBuffer())
  if (encryptedKey && contentKeySecret) {
    const contentKey = decryptContentKey(encryptedKey, contentKeySecret)
    content = decryptContent(content, contentKey) as Buffer
  }
  return { content }
}

// === Export: x402 download handler ===

export function x402DownloadHandler(db: AgentsDatabase) {
  return async (req: Request, res: Response) => {
    const skill = db.getSkill(req.params.id)
    if (!skill) {
      res.status(404).json({ error: 'Skill not found' })
      return
    }

    const price = skill.price ?? '0'
    const paymentMethod = skill.payment_method ?? 'escrow'

    // --- Free download (existing behavior) ---
    if (paymentMethod === 'free' || price === '0' || price === '') {
      const escrow = db.getAvailableEscrowForSkill(req.params.id)
      if (escrow) {
        res.status(403).json({ error: 'Skill has active escrow. Use purchase-info endpoint.' })
        return
      }
      const swarmRef = skill.encrypted_data_ref
      if (!swarmRef || !isValidSwarmRef(swarmRef)) {
        res.status(404).json({ error: 'No content reference available' })
        return
      }
      const swarmUrl = (SWARM_GATEWAY).replace(/\/+$/, '')
      res.redirect(`${swarmUrl}/bytes/${swarmRef}`)
      return
    }

    // --- Escrow-gated (existing behavior) ---
    if (paymentMethod === 'escrow') {
      res.status(403).json({
        error: 'Paid skills require escrow-based download. Use purchase-info endpoint.',
      })
      return
    }

    // --- x402 paywall ---

    // Re-download support: buyer provides tx_hash + X-Buyer-Address header
    const redownloadTxHash = req.query.tx_hash as string
    if (redownloadTxHash) {
      const existing = db.getX402PaymentByTxHash(redownloadTxHash)
      if (existing && existing.skill_id === req.params.id) {
        const claimedBuyer = (req.headers['x-buyer-address'] as string || '').toLowerCase()
        if (!claimedBuyer) {
          res.status(401).json({
            error: 'X-Buyer-Address header required for re-download',
            hint: 'Set header to the wallet address that made the original purchase',
          })
          return
        }
        if (claimedBuyer !== existing.buyer_address.toLowerCase()) {
          res.status(403).json({ error: 'Buyer address does not match payment record' })
          return
        }
        const result = await fetchAndDecryptContent(
          skill.encrypted_data_ref, skill.x402_content_key, CONTENT_KEY_SECRET
        )
        if ('error' in result) {
          res.status(result.status).json({ error: result.error })
          return
        }
        const contentFormat = skill.product_type
          ? (db.getProductType(skill.product_type)?.content_format || 'bin')
          : 'bin'
        const ext = contentFormat === 'tar.gz' ? '.tar.gz' : `.${contentFormat}`
        const filename = sanitizeFilename(skill.title || 'download') + ext
        res.set('Content-Type', 'application/octet-stream')
        res.set('Content-Disposition', `attachment; filename="${filename}"`)
        res.set('X-Payment-TxHash', existing.tx_hash)
        res.send(result.content)
        return
      }
      // Invalid tx_hash — fall through to normal payment flow
    }

    // Validate content exists BEFORE accepting payment — don't take money for undeliverable content
    const swarmRef = skill.encrypted_data_ref
    if (!swarmRef || !isValidSwarmRef(swarmRef)) {
      res.status(404).json({ error: 'Skill has no downloadable content' })
      return
    }

    const paymentHeader = (req.headers['x-payment'] || req.headers['payment-signature']) as string

    if (!paymentHeader) {
      res.status(402).json(create402Response(
        req.params.id, price, skill.seller, req.originalUrl
      ))
      return
    }

    // Verify and settle payment via Coinbase facilitator
    const settlement = await verifyAndSettle(paymentHeader, price)
    if (!settlement.success) {
      res.status(402).json({
        error: 'Payment verification failed',
        details: settlement.error,
        ...create402Response(req.params.id, price, skill.seller, req.originalUrl),
      })
      return
    }

    const paymentId = `x402-${Date.now()}-${crypto.randomBytes(16).toString('hex')}`

    // Record payment (returns false on duplicate tx_hash)
    const recorded = db.recordX402Payment({
      id: paymentId,
      skillId: req.params.id,
      buyerAddress: settlement.buyerAddress!,
      sellerAddress: skill.seller,
      amount: price,
      fee: '0',
      txHash: settlement.txHash!,
      settledAt: Math.floor(Date.now() / 1000),
    })
    if (!recorded) {
      res.status(409).json({
        error: 'Payment already processed',
        hint: `Re-download: GET /skills/${req.params.id}/download?tx_hash=${settlement.txHash}`,
      })
      return
    }

    db.incrementSkillSales(req.params.id)

    // Forward payment from proxy to seller (async, non-blocking)
    forwardPaymentToSeller(db, skill.seller, price, req.params.id, paymentId)
      .catch(err => console.error(`[x402] Forward failed for payment ${paymentId}:`, err.message))

    // Fetch and decrypt content (swarmRef already validated above)
    try {
      const result = await fetchAndDecryptContent(swarmRef, skill.x402_content_key, CONTENT_KEY_SECRET)
      if ('error' in result) {
        res.status(result.status).json({ error: result.error })
        return
      }
      const contentFormat = skill.product_type
        ? (db.getProductType(skill.product_type)?.content_format || 'bin')
        : 'bin'
      const ext = contentFormat === 'tar.gz' ? '.tar.gz' : `.${contentFormat}`
      const filename = sanitizeFilename(skill.title || 'download') + ext
      res.set('Content-Type', 'application/octet-stream')
      res.set('Content-Disposition', `attachment; filename="${filename}"`)
      res.set('X-Payment-TxHash', settlement.txHash!)
      res.send(result.content)
    } catch (err) {
      console.error('[x402] Content delivery error:', err)
      res.status(502).json({
        error: 'Content delivery failed after payment',
        hint: `Re-download: GET /skills/${req.params.id}/download?tx_hash=${settlement.txHash}`,
      })
    }
  }
}
