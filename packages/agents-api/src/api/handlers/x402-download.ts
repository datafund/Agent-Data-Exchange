import type { Request, Response } from 'express'
import type { AgentsDatabase } from '../../db/database.js'
import * as crypto from 'crypto'
import { type Chain, type PublicClient, type WalletClient, type Hex, keccak256, toBytes, createPublicClient, createWalletClient, http, verifyTypedData } from 'viem'
import { base, baseSepolia } from 'viem/chains'
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

// Network configuration — fail-fast if misconfigured
// usdcName differs: mainnet "USD Coin", testnet "USDC" (for EIP-712 domain)
const SUPPORTED_NETWORKS: Record<string, { chain: Chain; usdc: string; usdcName: string }> = {
  'eip155:8453':  { chain: base, usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', usdcName: 'USD Coin' },
  'eip155:84532': { chain: baseSepolia, usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', usdcName: 'USDC' },
}
const X402_NETWORK = process.env.X402_NETWORK || 'eip155:8453'
const networkConfig = SUPPORTED_NETWORKS[X402_NETWORK]
if (!networkConfig) throw new Error(`[x402] Unsupported X402_NETWORK: ${X402_NETWORK}. Supported: ${Object.keys(SUPPORTED_NETWORKS).join(', ')}`)

// === Configuration (validated at startup — see Task 4b Step 3) ===

const FACILITATOR_URL = process.env.X402_FACILITATOR_URL || 'https://x402.org/facilitator'
const PAYMENT_PROXY = process.env.PAYMENT_PROXY_ADDRESS || ''
const RELAYER_KEY = process.env.RELAYER_KEY || ''
const CONTENT_KEY_SECRET = process.env.X402_CONTENT_KEY_SECRET || ''
const SWARM_GATEWAY = process.env.SWARM_GATEWAY_URL || 'https://bee.fairdrop.xyz'

// === Settlement ===

// EIP-3009 TransferWithAuthorization ABI (USDC)
const TRANSFER_WITH_AUTHORIZATION_ABI = [{
  name: 'transferWithAuthorization',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
    { name: 'v', type: 'uint8' },
    { name: 'r', type: 'bytes32' },
    { name: 's', type: 'bytes32' },
  ],
  outputs: [],
}] as const

const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const

// x402.org facilitator v2 has a bug for EVM chains — use v1 for Sepolia.
// v1 uses plain network names; v2 uses CAIP-2 (eip155:CHAIN_ID).
const V1_NETWORK_NAMES: Record<string, string> = {
  'eip155:8453':  'base',
  'eip155:84532': 'base-sepolia',
}

interface SettlementResult {
  success: boolean
  txHash?: string
  buyerAddress?: string
  settledAmount?: string
  error?: string
}

function decodePaymentPayload(paymentHeader: string): { payload: any } | { error: string } {
  try {
    return { payload: JSON.parse(Buffer.from(paymentHeader, 'base64').toString('utf8')) }
  } catch {
    return { error: 'Invalid payment header: not valid base64 JSON' }
  }
}

// Self-settlement: verify signature + call transferWithAuthorization directly.
// Used when RELAYER_KEY is set (production). Eliminates external facilitator dependency.
async function selfSettle(
  paymentPayload: any,
  expectedAmount: string
): Promise<SettlementResult> {
  const auth = paymentPayload?.payload?.authorization
  const sig = paymentPayload?.payload?.signature as Hex | undefined
  if (!auth || !sig) {
    return { success: false, error: 'Payment payload missing authorization or signature' }
  }

  // Verify EIP-712 signature
  const domain = {
    name: networkConfig.usdcName,
    version: '2' as const,
    chainId: networkConfig.chain.id,
    verifyingContract: networkConfig.usdc as Hex,
  }
  const message = {
    from: auth.from as Hex,
    to: auth.to as Hex,
    value: BigInt(auth.value),
    validAfter: BigInt(auth.validAfter),
    validBefore: BigInt(auth.validBefore),
    nonce: auth.nonce as Hex,
  }

  const valid = await verifyTypedData({
    address: auth.from as Hex,
    domain,
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: 'TransferWithAuthorization',
    message,
    signature: sig,
  })
  if (!valid) {
    return { success: false, error: 'Invalid EIP-3009 signature' }
  }

  // Validate amount matches
  if (auth.value !== expectedAmount) {
    return { success: false, error: `Amount mismatch: signed ${auth.value}, expected ${expectedAmount}` }
  }

  // Submit transferWithAuthorization on-chain via relayer
  const pub = createPublicClient({ chain: networkConfig.chain, transport: http() })
  const account = privateKeyToAccount(RELAYER_KEY as `0x${string}`)
  const wallet = createWalletClient({ chain: networkConfig.chain, transport: http(), account })

  // Split signature into v, r, s
  const r = ('0x' + sig.slice(2, 66)) as Hex
  const s = ('0x' + sig.slice(66, 130)) as Hex
  const v = parseInt(sig.slice(130, 132), 16)

  try {
    const { request } = await pub.simulateContract({
      address: networkConfig.usdc as Hex,
      abi: TRANSFER_WITH_AUTHORIZATION_ABI,
      functionName: 'transferWithAuthorization',
      args: [
        auth.from as Hex, auth.to as Hex,
        BigInt(auth.value), BigInt(auth.validAfter), BigInt(auth.validBefore),
        auth.nonce as Hex,
        v, r, s,
      ],
      account,
    })
    const txHash = await wallet.writeContract(request)
    console.error(`[x402] Self-settled: ${auth.from} → ${auth.to} ${auth.value} USDC, tx: ${txHash}`)
    return { success: true, txHash, buyerAddress: auth.from, settledAmount: auth.value }
  } catch (err) {
    return { success: false, error: `On-chain settlement failed: ${(err as Error).message}` }
  }
}

// External facilitator settlement (x402.org — testnet only).
async function facilitatorSettle(
  paymentPayload: any,
  paymentHeader: string,
  paymentRequirements: Record<string, unknown>,
  expectedAmount: string
): Promise<SettlementResult> {
  // Rewrite to v1 format (x402.org v2 has a bug for EVM chains)
  const v1Network = V1_NETWORK_NAMES[X402_NETWORK] || X402_NETWORK
  const v1Payload = { ...paymentPayload, x402Version: 1, network: v1Network }

  const res = await fetch(`${FACILITATOR_URL}/settle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      paymentPayload: v1Payload,
      paymentRequirements: {
        ...paymentRequirements,
        network: v1Network,
        extra: { name: networkConfig.usdcName, version: '2' },
      },
    }),
  })
  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    return { success: false, error: `Facilitator: ${res.status} ${errBody}` }
  }
  const data = await res.json() as any

  if (!data.success) {
    return { success: false, error: data.errorMessage || data.errorReason || 'Facilitator rejected payment' }
  }

  const txHash = data.transaction
  const buyerAddress = data.payer
  const settledAmount = paymentPayload?.payload?.authorization?.value || expectedAmount

  if (!txHash || !/^0x[0-9a-f]{64}$/i.test(txHash)) {
    return { success: false, error: `Invalid transaction hash from facilitator: ${txHash}` }
  }
  if (!buyerAddress) {
    return { success: false, error: 'No payer address from facilitator' }
  }

  return { success: true, txHash, buyerAddress, settledAmount }
}

async function verifyAndSettle(
  paymentHeader: string,
  paymentRequirements: Record<string, unknown>,
  expectedAmount: string
): Promise<SettlementResult> {
  try {
    const decoded = decodePaymentPayload(paymentHeader)
    if ('error' in decoded) return { success: false, error: decoded.error }
    const paymentPayload = decoded.payload

    // Self-settle when RELAYER_KEY is available (production).
    // Falls back to external facilitator (testnet / x402.org).
    if (RELAYER_KEY) {
      return selfSettle(paymentPayload, expectedAmount)
    }
    return facilitatorSettle(paymentPayload, paymentHeader, paymentRequirements, expectedAmount)
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

function create402Response(skillId: string, price: string, seller: string, resource: string) {
  return {
    x402Version: 2,
    paymentRequirements: [{
      scheme: 'exact',
      network: X402_NETWORK,
      maxAmountRequired: price,
      resource,
      description: `Purchase skill: ${skillId}`,
      payTo: PAYMENT_PROXY || seller,
      asset: networkConfig.usdc,
      extra: { seller, skillId },
    }],
  }
}

// === Proxy forward ===

let proxyClient: PaymentProxyClient | null = null

function getProxyClient(): PaymentProxyClient | null {
  if (proxyClient) return proxyClient
  if (!PAYMENT_PROXY || !RELAYER_KEY) return null
  const pub = createPublicClient({ chain: networkConfig.chain, transport: http() })
  const account = privateKeyToAccount(RELAYER_KEY as `0x${string}`)
  const wallet = createWalletClient({ chain: networkConfig.chain, transport: http(), account })
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
      seller as `0x${string}`, networkConfig.usdc as `0x${string}`, BigInt(amount), skillId
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
    const paymentReqs = create402Response(req.params.id, price, skill.seller, req.originalUrl)
    const settlement = await verifyAndSettle(paymentHeader, paymentReqs.paymentRequirements[0], price)
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
