import { signMessage } from 'viem/accounts'
import { session } from '../session.js'

export const registerAccountTool = {
  name: 'df_register_account',
  description: `Register ENS subdomain and get FREE 4GB Swarm stamp (valid 1 week).

Requires df_generate_keypair first — keys are generated and stored locally.
This tool registers your local identity on-chain and allocates storage.`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      subdomain: {
        type: 'string',
        description: 'ENS subdomain to register (e.g., "alice" → alice.fairdata.eth)',
      },
      api_url: {
        type: 'string',
        description: 'FDS ID API URL (default: https://id.fairdatasociety.org)',
      },
    },
    required: ['subdomain'],
  },
  async execute(args: {
    subdomain: string
    api_url?: string
  }) {
    // Require local keys
    const rawPrivateKey = session.requirePrivateKey()
    const privateKey = rawPrivateKey.startsWith('0x') ? rawPrivateKey : `0x${rawPrivateKey}`
    const publicKey = session.publicKey
    const address = session.requireAddress()

    if (!publicKey) {
      throw new Error('No public key in session. Use df_generate_keypair first.')
    }

    const apiUrl = args.api_url || process.env.FDS_ID_API_URL || 'https://id.fairdatasociety.org'

    // Step 1: Register ENS subdomain
    const ensResponse = await fetch(`${apiUrl}/api/ens/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: args.subdomain,
        publicKey,
      }),
    })

    if (!ensResponse.ok) {
      const err = await ensResponse.json().catch(() => ({ error: ensResponse.statusText })) as Record<string, unknown>
      throw new Error(`ENS registration failed: ${err.error || ensResponse.statusText}`)
    }

    const ensData = await ensResponse.json() as {
      success?: boolean
      txHash?: string
      error?: string
    }

    session.setSubdomain(args.subdomain)

    // Step 2: Get trial stamp via SIWE auth
    // 2a: Get nonce
    const nonceResponse = await fetch(`${apiUrl}/api/auth/nonce`)
    if (!nonceResponse.ok) {
      throw new Error('Failed to get auth nonce')
    }
    const { nonce } = await nonceResponse.json() as { nonce: string }

    // 2b: Create SIWE message
    const issuedAt = new Date().toISOString()
    const siweMessage = `id.fairdatasociety.org wants you to sign in with your Ethereum account:
${address}

Sign in to FDS Identity Service

URI: https://id.fairdatasociety.org
Version: 1
Chain ID: 1
Nonce: ${nonce}
Issued At: ${issuedAt}`

    // 2c: Sign message
    const signature = await signMessage({
      message: siweMessage,
      privateKey: privateKey as `0x${string}`,
    })

    // 2d: Request trial stamp
    const stampResponse = await fetch(`${apiUrl}/api/stamp/trial`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: siweMessage,
        signature,
      }),
    })

    let stampData: { stampId?: string; expiresAt?: number; daysRemaining?: number; isNew?: boolean; error?: string } | null = null
    if (stampResponse.ok) {
      stampData = await stampResponse.json()
      if (stampData?.stampId) {
        session.setStampBatchId(stampData.stampId)
      }
    } else {
      const stampErr = await stampResponse.json().catch(() => ({})) as Record<string, unknown>
      stampData = { error: String(stampErr.error || stampResponse.statusText) }
    }

    const stampSuccess = !!stampData?.stampId

    return {
      success: stampSuccess,
      subdomain: args.subdomain,
      ensName: `${args.subdomain}.fairdata.eth`,
      walletAddress: address,
      publicKey,
      ens: ensData,
      stamp: stampSuccess ? {
        batchId: stampData!.stampId,
        capacity: '4GB for 1 week',
        daysRemaining: stampData!.daysRemaining,
        isNew: stampData!.isNew,
      } : {
        error: stampData?.error || 'Failed to allocate stamp',
        note: 'ENS registration succeeded. Retry stamp with SIWE auth or fund your own.',
      },
      session: 'Keys remain local, subdomain + stamp saved to session',
      next_steps: stampSuccess
        ? [
            'Ready to upload! Use df_sell to list content.',
            'Fund wallet with Base ETH for escrow transactions: https://bridge.base.org',
          ]
        : [
            'Stamp failed but ENS succeeded. You can still use the marketplace with your own stamp.',
            'Fund wallet with Base ETH: https://bridge.base.org',
          ],
    }
  },
}
