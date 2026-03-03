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

    let escrowId = args.escrow_id
    let encryptedDataRef: string | undefined

    // If skill_id provided, check payment method before expensive balance check
    if (!escrowId && args.skill_id) {
      const MARKETPLACE_URL = process.env.MARKETPLACE_URL || 'https://agents.datafund.io'

      // First check if this is an x402 skill — redirect to df_buy_x402
      const skillResponse = await fetch(
        `${MARKETPLACE_URL}/api/v1/skills/${args.skill_id}`
      )
      if (skillResponse.ok) {
        const skill = await skillResponse.json() as { payment_method?: string; title?: string }
        if (skill.payment_method === 'x402') {
          return {
            success: false,
            error: `Skill "${skill.title || args.skill_id}" uses x402 instant payment, not escrow. ` +
              `Use df_buy_x402 instead: df_buy_x402 skill_id="${args.skill_id}" output_path="./downloaded-content"`,
            payment_method: 'x402',
            redirect_tool: 'df_buy_x402',
          }
        }
      }

      const detailsResponse = await fetch(
        `${MARKETPLACE_URL}/api/v1/skills/${args.skill_id}/purchase-info`
      )
      if (!detailsResponse.ok) throw new Error('Failed to get skill details')
      const details = await detailsResponse.json() as { escrow_id: string; seller_address: string; encrypted_data_ref?: string; seller?: string }
      escrowId = details.escrow_id
      encryptedDataRef = details.encrypted_data_ref || undefined

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

    // Check balance — fail fast if account can't pay gas for escrow
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

    // If we have escrow_id but no encryptedDataRef, try to look it up from the marketplace
    if (!encryptedDataRef) {
      try {
        const MARKETPLACE_URL = process.env.MARKETPLACE_URL || 'https://agents.datafund.io'
        const escrowRes = await fetch(`${MARKETPLACE_URL}/api/v1/escrows/${escrowId}`)
        if (escrowRes.ok) {
          const escrowData = await escrowRes.json() as { skill_id?: string }
          if (escrowData.skill_id) {
            const skillRes = await fetch(`${MARKETPLACE_URL}/api/v1/skills/${escrowData.skill_id}/purchase-info`)
            if (skillRes.ok) {
              const skillData = await skillRes.json() as { encrypted_data_ref?: string }
              encryptedDataRef = skillData.encrypted_data_ref || undefined
            }
          }
        }
      } catch {
        // Non-fatal — buyer can provide it manually to df_download_content
      }
    }

    // Get escrow details to know the price
    const escrowInfo = await callRemoteTool('fairdrop_escrow_status', {
      escrow_id: escrowId,
    }) as { amount: string; seller: string }

    // Get buyer's public key from session (needed for seller to encrypt the decryption key)
    const buyerPublicKey = session.publicKey

    // Prepare fund transaction (include buyer public key for key encryption)
    const prepareResult = await callRemoteTool('fairdrop_prepare_fund', {
      escrow_id: escrowId,
      buyer_pubkey: buyerPublicKey, // Seller uses this to encrypt the decryption key
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

    session.setEscrow(escrowId, { role: 'buyer', encryptedDataRef })

    return {
      success: true,
      escrowId,
      txHash: submitResult.txHash,
      amount: escrowInfo.amount,
      next_steps: [
        'Wait for the seller to release the decryption key',
        'df_wait_for_state — poll until "Released"',
        'df_download_content — download and decrypt the content',
      ],
    }
  },
}
