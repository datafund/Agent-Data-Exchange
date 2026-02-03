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

export const releaseKeyTool = {
  name: 'df_release_key',
  description: 'Composite: Commit key → wait → reveal key (two on-chain transactions). Releases the decryption key to the buyer.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      escrow_id: {
        type: 'string',
        description: 'Escrow ID',
      },
      encryption_key: {
        type: 'string',
        description: 'Encryption key hex (uses session if omitted)',
      },
      buyer_pubkey: {
        type: 'string',
        description: 'Buyer public key hex (looked up from escrow if omitted)',
      },
      buyer_ens_name: {
        type: 'string',
        description: 'Buyer ENS name for public key lookup (e.g., "citrus.fairdata.eth")',
      },
    },
    required: ['escrow_id'],
  },
  async execute(args: {
    escrow_id: string
    encryption_key?: string
    buyer_pubkey?: string
    buyer_ens_name?: string
  }) {
    const privateKey = session.requirePrivateKey()
    const escrowState = session.getEscrow(args.escrow_id)
    let encryptionKey = args.encryption_key || escrowState?.encryptionKey

    // Try to load from backup file if not in session
    if (!encryptionKey) {
      const keyFilePath = path.join(ESCROW_KEYS_DIR, `escrow-${args.escrow_id}.json`)
      if (fs.existsSync(keyFilePath)) {
        try {
          const backup = JSON.parse(fs.readFileSync(keyFilePath, 'utf-8')) as { encryptionKey?: string }
          encryptionKey = backup.encryptionKey
        } catch {
          // Ignore parse errors
        }
      }
    }

    if (!encryptionKey) {
      throw new Error(
        `No encryption key found for escrow ${args.escrow_id}. ` +
        `Checked: session, backup file (~/.datafund/escrow-keys/escrow-${args.escrow_id}.json). ` +
        `Provide encryption_key manually if you have it backed up elsewhere.`
      )
    }

    // Get escrow status to check state and buyer pubkey
    const escrowInfo = await callRemoteTool('fairdrop_escrow_status', {
      escrow_id: args.escrow_id,
    }) as {
      buyer: string
      buyerPublicKey?: string
      buyerEnsName?: string
      state: string
      commitBlock?: number
    }

    // State machine check - KeyCommitted = 2
    const isKeyCommitted = escrowInfo.state === 'KeyCommitted' || escrowInfo.state === '2'

    // Get buyer pubkey from escrow if not provided
    let buyerPubkey = args.buyer_pubkey
    if (!buyerPubkey) {
      // First check if escrow status directly provides the public key
      if (escrowInfo.buyerPublicKey) {
        buyerPubkey = escrowInfo.buyerPublicKey
      } else {
        // Determine ENS name to lookup: parameter > escrow field > address
        const lookupName = args.buyer_ens_name || escrowInfo.buyerEnsName || escrowInfo.buyer

        // Only attempt lookup if we have an ENS name (contains ".")
        if (lookupName.includes('.')) {
          try {
            const lookupResult = await callRemoteTool('fairdrop_lookup', {
              name: lookupName,
            }) as { publicKey: string | null }

            buyerPubkey = lookupResult.publicKey || undefined
          } catch {
            // Lookup failed, will error below
          }
        }
      }

      if (!buyerPubkey) {
        throw new Error(
          `Cannot resolve buyer public key for ${escrowInfo.buyer}. ` +
          `The buyer may need to register an FDS identity first, or provide their public key directly. ` +
          `Use buyer_pubkey parameter to provide it manually.`
        )
      }
    }

    // Variables for commit data (either from new commit or loaded from session/file)
    let serializedEncryptedKey: string
    let commitmentSalt: string
    let commitTxHash: string | undefined

    // Check if already committed - if so, skip to reveal
    if (isKeyCommitted) {
      // Load commit data from session or backup file
      const savedCommitData = escrowState?.serializedEncryptedKey && escrowState?.commitmentSalt
        ? escrowState
        : loadCommitDataFromFile(args.escrow_id)

      if (!savedCommitData?.serializedEncryptedKey || !savedCommitData?.commitmentSalt) {
        throw new Error(
          `Escrow ${args.escrow_id} is in KeyCommitted state but commit data (salt) not found. ` +
          `Checked session and backup file. The commit data was likely lost. ` +
          `You may need to wait for escrow expiry or contact support.`
        )
      }

      serializedEncryptedKey = savedCommitData.serializedEncryptedKey
      commitmentSalt = savedCommitData.commitmentSalt
      commitTxHash = 'skipped-already-committed'

      // No need to wait - already past commit block
    } else {
      // Phase 1: Commit (only if not already committed)
      const commitResult = await callRemoteTool('fairdrop_prepare_commit', {
        escrow_id: args.escrow_id,
        encryption_key: encryptionKey,
        buyer_pubkey: buyerPubkey,
      }) as {
        transaction: Record<string, unknown>
        serializedEncryptedKey: string
        commitmentSalt: string
      }

      verifyTransaction(commitResult.transaction as UnsignedTx, {
        type: 'commitKeyRelease',
        escrowId: BigInt(args.escrow_id),
      })

      const commitSign = await signTransactionTool.execute({
        unsigned_tx: commitResult.transaction,
        private_key: privateKey,
        intent: { type: 'commitKeyRelease', escrowId: BigInt(args.escrow_id) },
      })

      const commitSubmit = await callRemoteTool('fairdrop_submit_tx', {
        signed_tx: commitSign.signed_tx,
      }) as { txHash: string }

      // Set commit data for reveal phase
      serializedEncryptedKey = commitResult.serializedEncryptedKey
      commitmentSalt = commitResult.commitmentSalt
      commitTxHash = commitSubmit.txHash

      // Save commit data to session AND file for reveal (survives restart)
      session.updateEscrow(args.escrow_id, {
        serializedEncryptedKey,
        commitmentSalt,
      })
      saveCommitDataToFile(args.escrow_id, serializedEncryptedKey, commitmentSalt)

      // Wait for 2+ blocks (~60s on Base)
      await new Promise(resolve => setTimeout(resolve, 65_000))
    }

    // Phase 2: Reveal (always runs - uses commit data from either path)
    const revealResult = await callRemoteTool('fairdrop_prepare_reveal', {
      escrow_id: args.escrow_id,
      serialized_encrypted_key: serializedEncryptedKey,
      commitment_salt: commitmentSalt,
    }) as { transaction: Record<string, unknown> }

    verifyTransaction(revealResult.transaction as UnsignedTx, {
      type: 'revealKey',
      escrowId: BigInt(args.escrow_id),
    })

    const revealSign = await signTransactionTool.execute({
      unsigned_tx: revealResult.transaction,
      private_key: privateKey,
      intent: { type: 'revealKey', escrowId: BigInt(args.escrow_id) },
    })

    const revealSubmit = await callRemoteTool('fairdrop_submit_tx', {
      signed_tx: revealSign.signed_tx,
    }) as { txHash: string }

    return {
      success: true,
      escrowId: args.escrow_id,
      commitTxHash: commitTxHash || 'already-committed',
      revealTxHash: revealSubmit.txHash,
      skippedCommit: isKeyCommitted,
      next_steps: [
        'Wait for the buyer to confirm receipt',
        'df_claim — claim your payment after buyer confirms or timeout',
      ],
    }
  },
}

// Helper to load commit data from backup file
function loadCommitDataFromFile(escrowId: string): { serializedEncryptedKey?: string; commitmentSalt?: string } | null {
  const keyFilePath = path.join(ESCROW_KEYS_DIR, `escrow-${escrowId}.json`)
  if (fs.existsSync(keyFilePath)) {
    try {
      return JSON.parse(fs.readFileSync(keyFilePath, 'utf-8'))
    } catch {
      return null
    }
  }
  return null
}

// Helper to save commit data to backup file
function saveCommitDataToFile(escrowId: string, serializedEncryptedKey: string, commitmentSalt: string): void {
  try {
    const keyFilePath = path.join(ESCROW_KEYS_DIR, `escrow-${escrowId}.json`)
    const existing = loadCommitDataFromFile(escrowId) || {}
    fs.writeFileSync(keyFilePath, JSON.stringify({
      ...existing,
      serializedEncryptedKey,
      commitmentSalt,
      commitSavedAt: new Date().toISOString(),
    }, null, 2), { mode: 0o600 })
  } catch {
    // Non-fatal
  }
}
