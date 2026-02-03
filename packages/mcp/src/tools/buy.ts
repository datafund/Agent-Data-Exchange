import { createPublicClient, http, formatEther } from 'viem'
import { base } from 'viem/chains'
import { session } from '../session.js'
import { callRemoteTool } from '../proxy.js'
import { verifyTransaction, type UnsignedTx } from '../tx-verify.js'
import { signTransactionTool } from './signing.js'

export const buyTool = {
  name: 'df_buy',
  description: 'Composite: Check reputation → prepare fund tx → verify → sign → submit. Single call to buy a skill.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      escrow_id: {
        type: 'string',
        description: 'Escrow ID to fund',
      },
      skill_id: {
        type: 'string',
        description: 'Marketplace skill ID (used to look up escrow_id if not provided)',
      },
      skip_reputation_check: {
        type: 'boolean',
        description: 'Skip seller reputation check (default: false)',
      },
    },
    required: [],
  },
  async execute(args: {
    escrow_id?: string
    skill_id?: string
    skip_reputation_check?: boolean
  }) {
    const privateKey = session.requirePrivateKey()
    const address = session.requireAddress()

    // Check balance — fail fast if account can't pay
    const publicClient = createPublicClient({
      chain: base,
      transport: http(process.env.BASE_RPC_URL || 'https://mainnet.base.org'),
    })
    const balance = await publicClient.getBalance({ address: address as `0x${string}` })
    if (balance === 0n) {
      throw new Error(
        `Account ${address} has zero ETH on Base. You need Base ETH to fund escrows. ` +
        `Bridge ETH to Base via https://bridge.base.org or get testnet ETH from a faucet.`
      )
    }

    let escrowId = args.escrow_id

    // If skill_id provided, look up escrow details
    if (!escrowId && args.skill_id) {
      const MARKETPLACE_URL = process.env.MARKETPLACE_URL || 'https://agents.datafund.io'
      const detailsResponse = await fetch(
        `${MARKETPLACE_URL}/api/v1/skills/${args.skill_id}/purchase-info`
      )
      if (!detailsResponse.ok) throw new Error('Failed to get skill details')
      const details = await detailsResponse.json() as { escrow_id: string; seller_address: string }
      escrowId = details.escrow_id

      // Check reputation
      if (!args.skip_reputation_check) {
        const repResponse = await fetch(
          `${MARKETPLACE_URL}/api/v1/wallets/${details.seller_address}/reputation`
        )
        if (repResponse.ok) {
          const rep = await repResponse.json() as { recommendation: string }
          if (rep.recommendation === 'avoid') {
            return {
              success: false,
              error: 'Seller has "avoid" reputation. Use skip_reputation_check=true to override.',
              reputation: rep,
            }
          }
        }
      }
    }

    if (!escrowId) {
      throw new Error('Provide escrow_id or skill_id')
    }

    // Get escrow details to know the price
    const escrowInfo = await callRemoteTool('fairdrop_escrow_status', {
      escrow_id: escrowId,
    }) as { amount: string; seller: string }

    // Prepare fund transaction
    const prepareResult = await callRemoteTool('fairdrop_prepare_fund', {
      escrow_id: escrowId,
    }) as { transaction: Record<string, unknown> }

    // Verify
    verifyTransaction(prepareResult.transaction as UnsignedTx, {
      type: 'fundEscrow',
      escrowId: BigInt(escrowId),
      expectedValue: BigInt(escrowInfo.amount),
    })

    // Sign
    const signResult = await signTransactionTool.execute({
      unsigned_tx: prepareResult.transaction,
      private_key: privateKey,
      intent: { type: 'fundEscrow', escrowId: BigInt(escrowId), expectedValue: BigInt(escrowInfo.amount) },
    })

    // Submit
    const submitResult = await callRemoteTool('fairdrop_submit_tx', {
      signed_tx: signResult.signed_tx,
    }) as { txHash: string }

    session.setEscrow(escrowId, { role: 'buyer' })

    return {
      success: true,
      escrowId,
      txHash: submitResult.txHash,
      amount: escrowInfo.amount,
      next_steps: [
        'Wait for the seller to release the decryption key',
        'df_wait_for_state — poll until "Released"',
        'df_claim — claim the content + download',
      ],
    }
  },
}
