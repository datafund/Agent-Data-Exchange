import { createPublicClient, http, formatEther, decodeEventLog, keccak256 } from 'viem'
import { base } from 'viem/chains'
import * as fs from 'fs'
import * as path from 'path'
import { session } from '../session.js'
import { callRemoteTool } from '../proxy.js'
import { verifyTransaction, type UnsignedTx } from '../tx-verify.js'
import { signTransactionTool } from './signing.js'

const ESCROW_KEYS_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '.',
  '.datafund',
  'escrow-keys'
)

// EscrowCreated event ABI for decoding (must match DataEscrow.sol)
const ESCROW_CREATED_EVENT = {
  type: 'event',
  name: 'EscrowCreated',
  inputs: [
    { name: 'escrowId', type: 'uint256', indexed: true },
    { name: 'seller', type: 'address', indexed: true },
    { name: 'paymentToken', type: 'address', indexed: false },
    { name: 'contentHash', type: 'bytes32', indexed: false },
    { name: 'keyCommitment', type: 'bytes32', indexed: false },
    { name: 'amount', type: 'uint256', indexed: false },
    { name: 'expiresAt', type: 'uint256', indexed: false },
    { name: 'disputeWindow', type: 'uint256', indexed: false },
    { name: 'sellerAgentId', type: 'uint256', indexed: false },
  ],
} as const

export const sellTool = {
  name: 'df_sell',
  description: 'Composite: Upload content → create escrow → sign → submit → publish to marketplace. Single call to list content for sale.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      content_base64: {
        type: 'string',
        description: 'Base64-encoded content to sell',
      },
      file_path: {
        type: 'string',
        description: 'Path to file to sell (alternative to content_base64)',
      },
      price_wei: {
        type: 'string',
        description: 'Price in wei',
      },
      name: {
        type: 'string',
        description: 'Skill/content name',
      },
      description: {
        type: 'string',
        description: 'Description of the content',
      },
      category: {
        type: 'string',
        description: 'Category: research, media, dataset, code, other',
      },
      expiry_days: {
        type: 'number',
        description: 'Escrow expiry in days (default: 7)',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Tags for marketplace discovery',
      },
    },
    required: ['price_wei', 'name', 'description', 'category'],
  },
  async execute(args: {
    content_base64?: string
    file_path?: string
    price_wei: string
    name: string
    description: string
    category: string
    expiry_days?: number
    tags?: string[]
  }) {
    const privateKey = session.requirePrivateKey()
    const address = session.requireAddress()

    // Step 0: Check balance — fail fast if account can't pay gas
    const publicClient = createPublicClient({
      chain: base,
      transport: http(process.env.BASE_RPC_URL || 'https://mainnet.base.org'),
    })
    const balance = await publicClient.getBalance({ address: address as `0x${string}` })
    if (balance === 0n) {
      throw new Error(
        `Account ${address} has zero ETH on Base. You need Base ETH for gas fees. ` +
        `Bridge ETH to Base via https://bridge.base.org or get testnet ETH from a faucet.`
      )
    }
    const balanceEth = formatEther(balance)
    // Warn if very low (< 0.0005 ETH ~ barely enough for one tx)
    if (balance < 500_000_000_000_000n) {
      throw new Error(
        `Account ${address} has only ${balanceEth} ETH on Base — likely not enough for gas. ` +
        `Top up via https://bridge.base.org before selling.`
      )
    }

    // Step 1: Prepare escrow (uploads content, returns unsigned tx)
    // Retries the entire prepare (encrypt + upload) if Swarm verification fails.
    const MAX_UPLOAD_ATTEMPTS = 3
    let prepareResult!: {
      transaction: Record<string, unknown>
      encryptedDataRef: string
      contentHash: string
      keyCommitment: string
      encryptionKey: string
      salt: string
    }

    for (let uploadAttempt = 1; uploadAttempt <= MAX_UPLOAD_ATTEMPTS; uploadAttempt++) {
      prepareResult = await callRemoteTool('fairdrop_prepare_escrow', {
        content_base64: args.content_base64,
        file_path: args.file_path,
        price_wei: args.price_wei,
        expiry_days: args.expiry_days || 7,
        name: args.name,
        description: args.description,
        category: args.category,
      }) as typeof prepareResult

      if (!prepareResult.encryptedDataRef) {
        throw new Error(
          'fairdrop_prepare_escrow did not return an encryptedDataRef. ' +
          'The Swarm upload may have failed silently. Check the Bee node connection and postage stamp balance.'
        )
      }

      // Step 1b: Verify uploaded data is retrievable from Swarm before committing on-chain
      const verified = await verifySwarmUpload(
        prepareResult.encryptedDataRef,
        prepareResult.contentHash,
      )

      if (verified) break

      if (uploadAttempt < MAX_UPLOAD_ATTEMPTS) {
        // Wait before retry — gives Swarm time to propagate or postage issue to be noticed
        const delay = uploadAttempt * 5_000
        await new Promise(r => setTimeout(r, delay))
      } else {
        throw new Error(
          `Swarm upload verification failed after ${MAX_UPLOAD_ATTEMPTS} attempts. ` +
          `The encrypted content (ref: ${prepareResult.encryptedDataRef}) could not be downloaded back from Swarm. ` +
          'Possible causes:\n' +
          '  1. Postage stamp has insufficient balance or has expired — check with fairdrop_status\n' +
          '  2. Bee node is not synced or not connected to the network\n' +
          '  3. Network propagation delay — try again in a few minutes\n' +
          'The on-chain escrow was NOT created. No funds were spent.'
        )
      }
    }

    // Step 2: Verify transaction intent
    verifyTransaction(prepareResult.transaction as UnsignedTx, {
      type: 'createEscrow',
    })

    // Step 3: Sign
    const signResult = await signTransactionTool.execute({
      unsigned_tx: prepareResult.transaction,
      private_key: privateKey,
      intent: { type: 'createEscrow' },
    })

    // Step 4: Submit
    const submitResult = await callRemoteTool('fairdrop_submit_tx', {
      signed_tx: signResult.signed_tx,
    }) as { txHash: string; blockNumber: string }

    // Step 5: Wait for transaction confirmation and extract escrow ID from receipt
    const txHash = submitResult.txHash as `0x${string}`
    let receipt
    try {
      receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
        confirmations: 1,
        timeout: 60_000, // 60 second timeout
      })
    } catch (err) {
      throw new Error(
        `Escrow transaction submitted (txHash: ${submitResult.txHash}) but confirmation timed out. ` +
        `The transaction may still be pending. Check status on https://basescan.org/tx/${submitResult.txHash}`
      )
    }

    // Step 6: Extract escrow ID from EscrowCreated event in receipt
    let escrowId: string | undefined

    // Look for EscrowCreated event in logs
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: [ESCROW_CREATED_EVENT],
          data: log.data,
          topics: log.topics,
        })
        if (decoded.eventName === 'EscrowCreated') {
          escrowId = decoded.args.escrowId.toString()
          break
        }
      } catch {
        // Not our event, continue
      }
    }

    // Fallback: poll escrow list if event decoding failed
    if (!escrowId) {
      const maxAttempts = 5
      const retryDelay = 2000

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const escrowStatus = await callRemoteTool('fairdrop_escrow_list', {
          address,
          role: 'seller',
          limit: 10,
        }) as { escrows: Array<{ escrowId: string; txHash?: string }> }

        const matchingEscrow = escrowStatus.escrows?.find(
          (e) => e.txHash === submitResult.txHash
        )
        if (matchingEscrow) {
          escrowId = matchingEscrow.escrowId
          break
        }

        if (escrowStatus.escrows?.length > 0) {
          escrowId = escrowStatus.escrows[0].escrowId
          break
        }

        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, retryDelay))
        }
      }
    }

    if (!escrowId) {
      throw new Error(
        `Escrow transaction confirmed (txHash: ${submitResult.txHash}) but escrow ID could not be extracted from receipt or list. ` +
        `Check the tx on https://basescan.org/tx/${submitResult.txHash}`
      )
    }

    // Save escrow state to session AND persist to disk
    session.setEscrow(escrowId, {
      encryptionKey: prepareResult.encryptionKey,
      role: 'seller',
    })

    // CRITICAL: Persist encryption key to disk (survives server restart)
    let keyFilePath: string | null = null
    try {
      fs.mkdirSync(ESCROW_KEYS_DIR, { recursive: true, mode: 0o700 })
      keyFilePath = path.join(ESCROW_KEYS_DIR, `escrow-${escrowId}.json`)
      fs.writeFileSync(keyFilePath, JSON.stringify({
        escrowId,
        encryptionKey: prepareResult.encryptionKey,
        encryptedDataRef: prepareResult.encryptedDataRef,
        salt: prepareResult.salt,
        contentHash: prepareResult.contentHash,
        seller: address,
        createdAt: new Date().toISOString(),
      }, null, 2), { mode: 0o600 })
    } catch (err) {
      // Non-fatal but warn
      keyFilePath = `FAILED: ${err instanceof Error ? err.message : String(err)}`
    }

    // Step 7: Publish to marketplace
    let marketplaceResult: unknown = null
    let marketplaceError: string | null = null
    try {
      const MARKETPLACE_URL = process.env.MARKETPLACE_URL || 'https://agents.datafund.io'
      const pubResponse = await fetch(`${MARKETPLACE_URL}/api/v1/skills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seller: address,
          title: args.name,
          description: args.description,
          category: args.category,
          price: args.price_wei,
          priceToken: 'ETH',
          escrowId: parseInt(escrowId, 10),
          contentHash: prepareResult.contentHash,
          encryptedDataRef: prepareResult.encryptedDataRef,
          tags: args.tags || [],
        }),
      })
      if (pubResponse.ok) {
        marketplaceResult = await pubResponse.json()
      } else {
        const errorBody = await pubResponse.text()
        marketplaceError = `Marketplace returned ${pubResponse.status}: ${errorBody}`
      }
    } catch (err) {
      marketplaceError = `Marketplace request failed: ${err instanceof Error ? err.message : String(err)}`
    }

    return {
      success: true,
      escrowId,
      txHash: submitResult.txHash,
      contentHash: prepareResult.contentHash,
      encryptedDataRef: prepareResult.encryptedDataRef,
      encryptionKey: prepareResult.encryptionKey,
      keyBackupFile: keyFilePath,
      marketplace: marketplaceResult,
      marketplaceError,
      warning: '⚠️ SAVE THE ENCRYPTION KEY! Without it, you cannot release the content to buyers. Key is backed up to ' + keyFilePath,
      next_steps: [
        'IMPORTANT: Verify key backup exists at ' + keyFilePath,
        'Wait for a buyer to fund the escrow',
        'df_wait_for_state — poll until "Funded"',
        'df_release_key — release the decryption key after payment',
      ],
    }
  },
}

/**
 * Verify that uploaded data exists on Swarm and matches the expected content hash.
 * Retries download with backoff to account for Swarm propagation delay.
 */
async function verifySwarmUpload(
  encryptedDataRef: string,
  expectedContentHash: string,
): Promise<boolean> {
  const MAX_DOWNLOAD_ATTEMPTS = 3
  const RETRY_DELAY_MS = 3_000

  for (let attempt = 1; attempt <= MAX_DOWNLOAD_ATTEMPTS; attempt++) {
    try {
      const downloadResult = (await callRemoteTool('fairdrop_download_bytes', {
        reference: encryptedDataRef,
      })) as { data_base64: string; size: number }

      if (!downloadResult.data_base64 || downloadResult.size === 0) {
        if (attempt < MAX_DOWNLOAD_ATTEMPTS) {
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
          continue
        }
        return false
      }

      // Verify content hash matches what prepareEscrow computed
      const blob = Buffer.from(downloadResult.data_base64, 'base64')
      const computedHash = keccak256(new Uint8Array(blob))
      const expected = expectedContentHash.startsWith('0x')
        ? expectedContentHash
        : `0x${expectedContentHash}`

      if (computedHash.toLowerCase() !== expected.toLowerCase()) {
        throw new Error(
          `Swarm content hash mismatch after upload. ` +
          `Expected: ${expected}, got: ${computedHash}. ` +
          'The data on Swarm does not match what was encrypted locally. This should not happen.'
        )
      }

      return true
    } catch (err) {
      // If it's a hash mismatch, don't retry — something is fundamentally wrong
      if (err instanceof Error && err.message.includes('hash mismatch')) {
        throw err
      }
      if (attempt < MAX_DOWNLOAD_ATTEMPTS) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
      }
    }
  }
  return false
}
