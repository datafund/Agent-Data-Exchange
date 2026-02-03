import { session } from '../session.js'
import { callRemoteTool } from '../proxy.js'
import { verifyTransaction, type UnsignedTx } from '../tx-verify.js'
import { signTransactionTool } from './signing.js'

export const claimTool = {
  name: 'df_claim',
  description: 'Composite: Claim payment (seller) or claim expired funds (buyer). Also downloads content for buyer if key is released.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      escrow_id: {
        type: 'string',
        description: 'Escrow ID',
      },
      role: {
        type: 'string',
        description: 'Your role: "seller" (claim payment) or "buyer" (claim expired)',
      },
      output_path: {
        type: 'string',
        description: 'For buyer: path to save downloaded content',
      },
    },
    required: ['escrow_id'],
  },
  async execute(args: {
    escrow_id: string
    role?: string
    output_path?: string
  }) {
    const privateKey = session.requirePrivateKey()
    const escrowState = session.getEscrow(args.escrow_id)
    const role = args.role || escrowState?.role || 'seller'

    const claimType = role === 'seller' ? 'claimPayment' : 'claimExpired'

    // Prepare claim
    const prepareResult = await callRemoteTool('fairdrop_prepare_claim', {
      escrow_id: args.escrow_id,
      role,
    }) as { transaction: Record<string, unknown> }

    verifyTransaction(prepareResult.transaction as UnsignedTx, {
      type: claimType,
      escrowId: BigInt(args.escrow_id),
    })

    const signResult = await signTransactionTool.execute({
      unsigned_tx: prepareResult.transaction,
      private_key: privateKey,
      intent: { type: claimType, escrowId: BigInt(args.escrow_id) },
    })

    const submitResult = await callRemoteTool('fairdrop_submit_tx', {
      signed_tx: signResult.signed_tx,
    }) as { txHash: string }

    // For buyer: download content if output_path provided
    let download = null
    if (role === 'buyer' && args.output_path) {
      try {
        const escrowInfo = await callRemoteTool('fairdrop_escrow_status', {
          escrow_id: args.escrow_id,
        }) as { contentHash: string }

        download = await callRemoteTool('fairdrop_download', {
          reference: escrowInfo.contentHash,
          output_path: args.output_path,
        })
      } catch {
        download = { error: 'Download failed — content may need decryption key' }
      }
    }

    return {
      success: true,
      escrowId: args.escrow_id,
      role,
      claimType,
      txHash: submitResult.txHash,
      download,
    }
  },
}
