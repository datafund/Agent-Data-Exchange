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
  description: 'Composite: Commit key → wait → reveal key (two on-chain transactions). Releases the decryption key to the buyer. Automatically resumes from KEY_COMMITTED state if commit was already done.',
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
    const backupData = loadCommitDataFromFile(args.escrow_id)
    if (!encryptionKey) {
      encryptionKey = backupData?.encryptionKey
    }

    if (!encryptionKey) {
      throw new Error(
        `No encryption key found for escrow ${args.escrow_id}. ` +
        `Checked: session, backup file (~/.datafund/escrow-keys/escrow-${args.escrow_id}.json). ` +
        `Provide encryption_key manually if you have it backed up elsewhere.`
      )
    }

    // Check for saved commit data FIRST (most reliable indicator of KEY_COMMITTED)
    const savedCommitData = (escrowState?.serializedEncryptedKey && escrowState?.commitmentSalt)
      ? escrowState
      : backupData

    const hasCommitData = !!(savedCommitData?.serializedEncryptedKey && savedCommitData?.commitmentSalt)

    // Get escrow status for buyer pubkey and state verification
    let escrowInfo: {
      buyer: string
      buyerPublicKey?: string
      buyerEnsName?: string
      state?: string
      stateCode?: number
      commitBlock?: number
    }

    try {
      escrowInfo = await callRemoteTool('fairdrop_escrow_status', {
        escrow_id: args.escrow_id,
      }) as typeof escrowInfo
    } catch (err: any) {
      // If we have commit data, we can still try reveal without remote state
      if (hasCommitData && args.buyer_pubkey) {
        escrowInfo = { buyer: 'unknown', state: 'KEY_COMMITTED' }
      } else {
        throw new Error(`Failed to get escrow status: ${err?.message || err}`)
      }
    }

    // Determine if escrow is in KEY_COMMITTED state
    // Check multiple formats: string state, stateCode number, AND local commit data
    const stateStr = String(escrowInfo.state || '').toUpperCase().replace(/[_\s]/g, '')
    const isKeyCommitted = hasCommitData ||
      stateStr === 'KEYCOMMITTED' ||
      escrowInfo.stateCode === 2 ||
      escrowInfo.state === '2'

    // Get buyer pubkey from escrow if not provided
    let buyerPubkey = args.buyer_pubkey
    if (!buyerPubkey) {
      if (escrowInfo.buyerPublicKey) {
        buyerPubkey = escrowInfo.buyerPublicKey
      } else {
        const lookupName = args.buyer_ens_name || escrowInfo.buyerEnsName || escrowInfo.buyer
        if (lookupName && lookupName.includes('.')) {
          try {
            const lookupResult = await callRemoteTool('fairdrop_lookup', {
              name: lookupName,
            }) as { publicKey: string | null }
            buyerPubkey = lookupResult.publicKey || undefined
          } catch {
            // Lookup failed
          }
        }
      }

      if (!buyerPubkey) {
        throw new Error(
          `Cannot resolve buyer public key for ${escrowInfo.buyer}. ` +
          `Provide buyer_pubkey parameter manually.`
        )
      }
    }

    let serializedEncryptedKey: string
    let commitmentSalt: string
    let commitTxHash: string | undefined

    if (isKeyCommitted && hasCommitData) {
      // Resume from KEY_COMMITTED — skip straight to reveal
      serializedEncryptedKey = savedCommitData!.serializedEncryptedKey!
      commitmentSalt = savedCommitData!.commitmentSalt!
      commitTxHash = 'skipped-already-committed'
    } else if (isKeyCommitted && !hasCommitData) {
      throw new Error(
        `Escrow ${args.escrow_id} is in KeyCommitted state but commit data (salt) not found locally. ` +
        `Checked session and ~/.datafund/escrow-keys/escrow-${args.escrow_id}.json. ` +
        `The commit data was lost. Wait for escrow expiry to reclaim funds.`
      )
    } else {
      // Phase 1: Commit
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

      serializedEncryptedKey = commitResult.serializedEncryptedKey
      commitmentSalt = commitResult.commitmentSalt
      commitTxHash = commitSubmit.txHash

      // Save commit data for reveal (survives restart)
      session.updateEscrow(args.escrow_id, {
        serializedEncryptedKey,
        commitmentSalt,
      })
      saveCommitDataToFile(args.escrow_id, serializedEncryptedKey, commitmentSalt)

      // Wait for 2+ blocks (~60s on Base)
      await new Promise(resolve => setTimeout(resolve, 65_000))
    }

    // Phase 2: Reveal
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
      skippedCommit: commitTxHash === 'skipped-already-committed',
      next_steps: [
        'Wait for the buyer to confirm receipt',
        'df_claim — claim your payment after buyer confirms or timeout',
      ],
    }
  },
}

function loadCommitDataFromFile(escrowId: string): {
  encryptionKey?: string
  serializedEncryptedKey?: string
  commitmentSalt?: string
} | null {
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

function saveCommitDataToFile(escrowId: string, serializedEncryptedKey: string, commitmentSalt: string): void {
  try {
    fs.mkdirSync(ESCROW_KEYS_DIR, { recursive: true, mode: 0o700 })
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
