import { signMessage } from 'viem/accounts'
import { createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'
import { FDSKeystoreManager } from '@fairdatasociety/fds-id'
import { session } from '../session.js'

export const registerAccountTool = {
  name: 'df_register_account',
  description: `Full account registration: ENS subdomain + stamp + keystore backup.

1. Register ENS subdomain (addr + public key)
2. Allocate FREE 4GB Swarm stamp (1 week trial)
3. Create encrypted keystore
4. Backup keystore to Swarm + set encrypted hash in ENS

Requires df_generate_keypair first. After this, account is fully recoverable from any machine using just subdomain + password.`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      subdomain: {
        type: 'string',
        description: 'ENS subdomain to register (e.g., "alice" → alice.fairdata.eth)',
      },
      password: {
        type: 'string',
        description: 'Password for keystore encryption and backup (min 6 chars)',
      },
      api_url: {
        type: 'string',
        description: 'FDS ID API URL (default: https://id.fairdatasociety.org)',
      },
    },
    required: ['subdomain', 'password'],
  },
  async execute(args: {
    subdomain: string
    password: string
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

    // Validate ENS registration actually succeeded
    if (ensData.success === false || ensData.error) {
      throw new Error(`ENS registration failed: ${ensData.error || 'Unknown error (success=false)'}`)
    }

    // Only set subdomain if registration confirmed
    if (!ensData.txHash) {
      throw new Error('ENS registration response missing txHash - registration may not have completed')
    }

    // Verify ENS actually resolves (wait for tx confirmation + check resolver)
    const ensName = `${args.subdomain}.fairdata.eth`
    const publicClient = createPublicClient({
      chain: mainnet,
      transport: http(process.env.ETH_RPC_URL || 'https://eth.llamarpc.com'),
    })

    // Wait a bit for tx to be indexed, then verify
    let ensVerified = false
    for (let attempt = 0; attempt < 3; attempt++) {
      await new Promise(r => setTimeout(r, 5000)) // 5s between attempts
      try {
        const resolved = await publicClient.getEnsAddress({ name: ensName })
        if (resolved) {
          ensVerified = true
          break
        }
      } catch {
        // Not yet resolvable
      }
    }

    if (!ensVerified) {
      throw new Error(
        `ENS registration tx submitted (${ensData.txHash}) but name "${ensName}" does not resolve. ` +
        `The FDS identity server may have a bug - address record not set in resolver. ` +
        `Check tx on etherscan: https://etherscan.io/tx/${ensData.txHash}`
      )
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

    // Step 3: Create keystore and backup to Swarm + ENS
    let backupResult: { success: boolean; swarmReference?: string; ensTxHash?: string; error?: string } = {
      success: false,
      error: 'Not attempted',
    }

    try {
      // Create keystore
      const account = {
        subdomain: args.subdomain,
        publicKey: publicKey.startsWith('0x') ? publicKey.slice(2) : publicKey,
        privateKey: rawPrivateKey.replace(/^0x/, ''),
        walletAddress: address,
        created: Date.now(),
      }

      const keystore = await FDSKeystoreManager.encrypt(account, args.password)

      // Backup to Swarm + ENS via API
      const backupResponse = await fetch(`${apiUrl}/api/backup/full`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keystore,
          password: args.password,
          subdomain: args.subdomain,
          publicKey: publicKey.startsWith('0x') ? publicKey : `0x${publicKey}`,
        }),
      })

      if (backupResponse.ok) {
        const data = await backupResponse.json() as {
          success: boolean
          swarmReference?: string
          ensTxHash?: string
          error?: string
        }
        backupResult = data
      } else {
        const err = await backupResponse.json().catch(() => ({})) as { error?: string }
        backupResult = { success: false, error: err.error || backupResponse.statusText }
      }
    } catch (error) {
      backupResult = { success: false, error: (error as Error).message }
    }

    return {
      success: true,
      subdomain: args.subdomain,
      ensName: `${args.subdomain}.fairdata.eth`,
      walletAddress: address,
      publicKey,
      ens: {
        registered: true,
        txHash: ensData.txHash,
      },
      stamp: stampSuccess ? {
        allocated: true,
        batchId: stampData!.stampId,
        capacity: '4GB for 1 week',
        daysRemaining: stampData!.daysRemaining,
        isNew: stampData!.isNew,
      } : {
        allocated: false,
        error: stampData?.error || 'Failed to allocate stamp',
      },
      backup: backupResult.success ? {
        saved: true,
        swarmReference: backupResult.swarmReference,
        ensTxHash: backupResult.ensTxHash,
        recoverable: `Use subdomain "${args.subdomain}" + password to restore from any machine`,
      } : {
        saved: false,
        error: backupResult.error,
        note: 'Use df_backup_keystore to retry backup manually.',
      },
      session: 'Keys remain local, subdomain + stamp saved to session',
      next_steps: [
        'Ready to use! df_sell to list content, df_buy to purchase.',
        'Fund wallet with Base ETH for escrow transactions: https://bridge.base.org',
      ],
    }
  },
}
