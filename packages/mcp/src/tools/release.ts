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
    },
    required: ['escrow_id'],
  },
  async execute(args: {
    escrow_id: string
    encryption_key?: string
    buyer_pubkey?: string
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

    // Get buyer pubkey from escrow if not provided
    let buyerPubkey = args.buyer_pubkey
    if (!buyerPubkey) {
      const escrowInfo = await callRemoteTool('fairdrop_escrow_status', {
        escrow_id: args.escrow_id,
      }) as { buyer: string }

      // Resolve buyer's public key via ENS lookup
      const lookupResult = await callRemoteTool('fairdrop_lookup', {
        name: escrowInfo.buyer,
      }) as { publicKey: string | null }

      buyerPubkey = lookupResult.publicKey || undefined
      if (!buyerPubkey) {
        throw new Error(`Cannot resolve buyer public key for ${escrowInfo.buyer}. Provide buyer_pubkey manually.`)
      }
    }

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

    // Save commit data to session for reveal
    session.updateEscrow(args.escrow_id, {
      serializedEncryptedKey: commitResult.serializedEncryptedKey,
      commitmentSalt: commitResult.commitmentSalt,
    })

    // Wait for 2+ blocks (~60s on Base)
    await new Promise(resolve => setTimeout(resolve, 65_000))

    // Phase 2: Reveal
    const revealResult = await callRemoteTool('fairdrop_prepare_reveal', {
      escrow_id: args.escrow_id,
      serialized_encrypted_key: commitResult.serializedEncryptedKey,
      commitment_salt: commitResult.commitmentSalt,
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
      commitTxHash: commitSubmit.txHash,
      revealTxHash: revealSubmit.txHash,
      next_steps: [
        'Wait for the buyer to confirm receipt',
        'df_claim — claim your payment after buyer confirms or timeout',
      ],
    }
  },
}
