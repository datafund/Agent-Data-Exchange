import { session } from '../session.js'
import { verifyTransaction, type UnsignedTx, type TxIntent } from '../tx-verify.js'

const DEFAULT_RPC: Record<number, string> = {
  1: 'https://ethereum.publicnode.com',
  8453: 'https://mainnet.base.org',
  11155111: 'https://ethereum-sepolia.publicnode.com',
}

export const signTransactionTool = {
  name: 'df_sign_transaction',
  description: 'Sign an unsigned transaction with the session private key. Verifies transaction intent before signing if intent is provided. Auto-fills gas and nonce via RPC.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      unsigned_tx: {
        type: 'object',
        description: 'Unsigned transaction (from fairdrop prepare_* or df_sell/df_buy). Fields: to, data, value, chainId.',
      },
      private_key: {
        type: 'string',
        description: 'Private key hex (uses session key if omitted)',
      },
      intent: {
        type: 'object',
        description: 'Transaction intent for verification (type, expectedValue, escrowId). Composite tools set this automatically.',
      },
      rpc_url: {
        type: 'string',
        description: 'RPC URL for gas estimation (defaults to public RPC for chain)',
      },
    },
    required: ['unsigned_tx'],
  },
  async execute(args: {
    unsigned_tx: Record<string, unknown>
    private_key?: string
    intent?: TxIntent
    rpc_url?: string
  }) {
    const { privateKeyToAccount } = await import('viem/accounts')
    const { createPublicClient, http } = await import('viem')
    const { mainnet, base, sepolia } = await import('viem/chains')

    // Verify intent if provided
    if (args.intent) {
      verifyTransaction(args.unsigned_tx as UnsignedTx, args.intent)
    }

    const CHAINS: Record<number, any> = { 1: mainnet, 8453: base, 11155111: sepolia }

    const privateKeyHex = (args.private_key || session.requirePrivateKey()).replace(/^0x/, '')
    const account = privateKeyToAccount(`0x${privateKeyHex}`)

    const tx = args.unsigned_tx
    const chainId = tx.chainId ? Number(tx.chainId) : 8453

    const txRequest: Record<string, unknown> = {
      chainId,
      type: 'eip1559' as const,
    }
    if (tx.to) txRequest.to = tx.to
    if (tx.data) txRequest.data = tx.data
    if (tx.value) {
      const val = String(tx.value)
      txRequest.value = BigInt(val)
    }

    const needsGas = !tx.gas
    const needsFees = !tx.maxFeePerGas && !tx.gasPrice
    const needsNonce = tx.nonce === undefined || tx.nonce === null

    if (needsGas || needsFees || needsNonce) {
      const rpcUrl = args.rpc_url || process.env.RPC_URL || DEFAULT_RPC[chainId]
      if (!rpcUrl) throw new Error(`No RPC URL for chain ${chainId}`)

      const chain = CHAINS[chainId]
      if (!chain) throw new Error(`Unsupported chain: ${chainId}`)

      const publicClient = createPublicClient({ chain, transport: http(rpcUrl) })

      const [gasEstimate, feeData, nonce] = await Promise.all([
        needsGas
          ? publicClient.estimateGas({
              account: account.address,
              to: txRequest.to as `0x${string}`,
              data: txRequest.data as `0x${string}` | undefined,
              value: (txRequest.value as bigint) || 0n,
            })
          : Promise.resolve(null),
        needsFees ? publicClient.estimateFeesPerGas() : Promise.resolve(null),
        needsNonce
          ? publicClient.getTransactionCount({ address: account.address })
          : Promise.resolve(null),
      ])

      if (gasEstimate !== null) txRequest.gas = gasEstimate + (gasEstimate * 20n / 100n)
      if (feeData !== null) {
        txRequest.maxFeePerGas = feeData.maxFeePerGas!
        txRequest.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas!
      }
      if (nonce !== null) txRequest.nonce = nonce
    }

    if (tx.gas) txRequest.gas = BigInt(tx.gas as string)
    if (tx.maxFeePerGas) txRequest.maxFeePerGas = BigInt(tx.maxFeePerGas as string)
    if (tx.maxPriorityFeePerGas) txRequest.maxPriorityFeePerGas = BigInt(tx.maxPriorityFeePerGas as string)
    if (tx.nonce !== undefined && tx.nonce !== null) txRequest.nonce = Number(tx.nonce)

    const signedTx = await account.signTransaction(txRequest as any)

    return {
      signed_tx: signedTx,
      from: account.address,
      chainId,
      verified: !!args.intent,
    }
  },
}
