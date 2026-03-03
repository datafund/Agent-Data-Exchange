/**
 * df_buy_x402 — purchase x402-priced skills via HTTP 402 payment protocol.
 *
 * Flow:
 *   1. Fetch skill details from marketplace API
 *   2. GET /skills/:id/download -> 402 with paymentRequirements
 *   3. Sign EIP-3009 transferWithAuthorization for USDC on Base
 *   4. Re-send GET with X-Payment header -> receive decrypted content
 *   5. Save content to output_path
 *
 * Re-download: provide tx_hash to skip payment (uses X-Buyer-Address header).
 */

import { writeFileSync, mkdirSync } from 'fs'
import { dirname, resolve } from 'path'
import { privateKeyToAccount } from 'viem/accounts'
import { isAddress, type Hex } from 'viem'
import { session } from '../session.js'

// --- Inlined helpers (from SDK, keep MCP self-contained) ---

function formatUsdc(smallestUnits: string): string {
  const n = BigInt(smallestUnits || '0')
  const whole = n / 1_000_000n
  const frac = n % 1_000_000n
  if (frac === 0n) return `$${whole}.00`
  const fracStr = frac.toString().padStart(6, '0')
  const trimmed = fracStr.replace(/0+$/, '')
  const display = trimmed.length < 2 ? trimmed.padEnd(2, '0') : trimmed
  return `$${whole}.${display}`
}

// USDC contract addresses by network
const NETWORK_CONFIG: Record<string, { chainId: number; usdcAddress: Hex }> = {
  'eip155:8453': { chainId: 8453, usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
  'eip155:84532': { chainId: 84532, usdcAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' },
}

function getNetworkConfig(network: string): { chainId: number; usdcAddress: Hex } {
  const config = NETWORK_CONFIG[network]
  if (!config) throw new Error(`Unsupported network: ${network}. Supported: ${Object.keys(NETWORK_CONFIG).join(', ')}`)
  return config
}

// EIP-3009 TransferWithAuthorization types
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

/**
 * Create a random bytes32 nonce for EIP-3009.
 */
function randomNonce(): Hex {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return ('0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')) as Hex
}

// --- Types ---

interface PaymentRequirement {
  scheme: string
  network: string
  maxAmountRequired?: string
  amount?: string
  asset: string
  payTo: string
  description?: string
  resource?: string
  extra?: Record<string, unknown>
  maxTimeoutSeconds?: number
}

interface PaymentRequiredResponse {
  x402Version: number
  paymentRequirements?: PaymentRequirement[]
  accepts?: PaymentRequirement[]
  error?: string
}

interface SkillDetails {
  id: string
  title: string
  price?: string
  payment_method?: string
  seller?: string
}

// --- Tool definition ---

export const buyX402Tool = {
  name: 'df_buy_x402',
  description:
    'Purchase an x402-priced skill via HTTP 402 micropayment. Signs a USDC transferWithAuthorization on Base and downloads the decrypted content.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      skill_id: {
        type: 'string',
        description: 'Marketplace skill ID to purchase',
      },
      output_path: {
        type: 'string',
        description: 'Local file path to save the downloaded content',
      },
      tx_hash: {
        type: 'string',
        description: 'Transaction hash from a previous purchase (re-download without paying again)',
      },
    },
    required: ['skill_id', 'output_path'],
  },

  async execute(args: {
    skill_id: string
    output_path: string
    tx_hash?: string
  }) {
    const MARKETPLACE_URL = process.env.MARKETPLACE_URL || 'https://agents.datafund.io'
    const downloadUrl = `${MARKETPLACE_URL}/api/v1/skills/${args.skill_id}/download`

    // --- Re-download path (skip payment) ---
    if (args.tx_hash) {
      const address = session.requireAddress()

      const redownloadUrl = new URL(downloadUrl)
      redownloadUrl.searchParams.set('tx_hash', args.tx_hash)
      const response = await fetch(redownloadUrl.toString(), {
        headers: {
          'X-Buyer-Address': address,
        },
      })

      if (!response.ok) {
        const body = await response.text()
        throw new Error(
          `Re-download failed (${response.status}): ${body}. ` +
          `Ensure the tx_hash is correct and X-Buyer-Address matches the original buyer.`
        )
      }

      const content = Buffer.from(await response.arrayBuffer())
      const resolvedPath = resolve(args.output_path)
      mkdirSync(dirname(resolvedPath), { recursive: true })
      writeFileSync(resolvedPath, content)

      return {
        success: true,
        skill_id: args.skill_id,
        output_path: resolvedPath,
        size_bytes: content.length,
        tx_hash: args.tx_hash,
        payment_amount: '0',
        payment_amount_formatted: 're-download (no charge)',
        next_steps: [
          'Content saved — verify the file contents',
          'Use df_skill_details to check skill metadata',
        ],
      }
    }

    // --- New purchase path ---
    const privateKey = session.requirePrivateKey()
    const address = session.requireAddress()
    const normalizedKey = (privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`) as Hex

    // Step 1: Fetch skill details to confirm it's an x402 skill
    const detailsRes = await fetch(`${MARKETPLACE_URL}/api/v1/skills/${args.skill_id}`)
    if (!detailsRes.ok) {
      if (detailsRes.status === 404) {
        throw new Error(`Skill not found: ${args.skill_id}`)
      }
      throw new Error(`Failed to fetch skill details (${detailsRes.status})`)
    }
    const skill = await detailsRes.json() as SkillDetails
    if (skill.payment_method !== 'x402') {
      throw new Error(
        `Skill "${skill.title || args.skill_id}" uses payment method "${skill.payment_method}", not x402. ` +
        (skill.payment_method === 'escrow'
          ? 'Use df_buy for escrow-based purchases.'
          : skill.payment_method === 'free'
            ? 'Use df_download_free for free content.'
            : 'This skill cannot be purchased with x402.')
      )
    }

    // Step 2: GET download endpoint -> expect 402 with payment requirements
    const initialRes = await fetch(downloadUrl)
    if (initialRes.status !== 402) {
      if (initialRes.ok) {
        // Free content returned directly — unexpected for x402 skill
        const content = Buffer.from(await initialRes.arrayBuffer())
        const resolvedPath = resolve(args.output_path)
        mkdirSync(dirname(resolvedPath), { recursive: true })
        writeFileSync(resolvedPath, content)
        return {
          success: true,
          skill_id: args.skill_id,
          output_path: resolvedPath,
          size_bytes: content.length,
          tx_hash: '',
          payment_amount: '0',
          payment_amount_formatted: '$0.00 (free)',
          next_steps: ['Content downloaded at no cost'],
        }
      }
      const body = await initialRes.text()
      throw new Error(
        `Expected 402 Payment Required but got ${initialRes.status}: ${body}`
      )
    }

    const paymentRequired = await initialRes.json() as PaymentRequiredResponse

    // Extract payment requirements (support both field names from server)
    const requirements = paymentRequired.paymentRequirements || paymentRequired.accepts
    if (!requirements || requirements.length === 0) {
      throw new Error(
        'Server returned 402 but no payment requirements. ' +
        `Response: ${JSON.stringify(paymentRequired).slice(0, 500)}`
      )
    }

    // Find an "exact" scheme requirement for a supported network
    const supportedNetworks = Object.keys(NETWORK_CONFIG)
    const req = requirements.find(r =>
      r.scheme === 'exact' && supportedNetworks.includes(r.network)
    ) || requirements[0]

    const paymentAmount = req.maxAmountRequired || req.amount || skill.price || '0'
    const payTo = req.payTo

    if (!payTo) {
      throw new Error('Payment requirement missing payTo address')
    }
    if (!isAddress(payTo)) {
      throw new Error(`Invalid payTo address from server: "${payTo}"`)
    }

    // Resolve chain-specific config (chainId + USDC address)
    const networkConfig = getNetworkConfig(req.network)

    // Step 3: Sign EIP-3009 transferWithAuthorization
    const account = privateKeyToAccount(normalizedKey)
    const now = Math.floor(Date.now() / 1000)
    const nonce = randomNonce()

    const authorization = {
      from: account.address,
      to: payTo as Hex,
      value: BigInt(paymentAmount),
      validAfter: BigInt(0),
      validBefore: BigInt(now + 3600), // 1 hour validity
      nonce,
    }

    const signature = await account.signTypedData({
      domain: {
        name: 'USD Coin',
        version: '2',
        chainId: networkConfig.chainId,
        verifyingContract: networkConfig.usdcAddress,
      },
      types: TRANSFER_WITH_AUTHORIZATION_TYPES,
      primaryType: 'TransferWithAuthorization',
      message: authorization,
    })

    // Step 4: Construct x402 payment payload
    const paymentPayload = {
      x402Version: 2,
      scheme: 'exact',
      network: req.network,
      payload: {
        signature,
        authorization: {
          from: authorization.from,
          to: authorization.to,
          value: paymentAmount,
          validAfter: '0',
          validBefore: (now + 3600).toString(),
          nonce,
        },
      },
    }

    // Base64 encode for X-Payment header
    const paymentHeader = Buffer.from(JSON.stringify(paymentPayload)).toString('base64')

    // Step 5: Re-send download request with payment
    const paidRes = await fetch(downloadUrl, {
      headers: {
        'X-Payment': paymentHeader,
      },
    })

    if (paidRes.status === 402) {
      const errorBody = await paidRes.json() as { error?: string; details?: string }
      throw new Error(
        `Payment rejected by facilitator: ${errorBody.details || errorBody.error || 'Unknown reason'}. ` +
        `Amount: ${formatUsdc(paymentAmount)}, payTo: ${payTo}, from: ${account.address}`
      )
    }

    if (!paidRes.ok) {
      const body = await paidRes.text()
      throw new Error(
        `Download failed after payment (${paidRes.status}): ${body}`
      )
    }

    // Step 6: Save content
    const content = Buffer.from(await paidRes.arrayBuffer())
    const resolvedPath = resolve(args.output_path)
    mkdirSync(dirname(resolvedPath), { recursive: true })
    writeFileSync(resolvedPath, content)

    // Extract tx hash from response header
    const txHash = paidRes.headers.get('X-Payment-TxHash') || ''

    return {
      success: true,
      skill_id: args.skill_id,
      output_path: resolvedPath,
      size_bytes: content.length,
      tx_hash: txHash,
      payment_amount: paymentAmount,
      payment_amount_formatted: formatUsdc(paymentAmount),
      next_steps: [
        `Content saved to ${resolvedPath} (${content.length} bytes)`,
        txHash ? `Transaction: ${txHash}` : 'Check marketplace for transaction details',
        `Re-download anytime with: df_buy_x402 skill_id="${args.skill_id}" tx_hash="${txHash}" output_path="..."`,
      ],
    }
  },
}
