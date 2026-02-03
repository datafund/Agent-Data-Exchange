export const ensResolveTool = {
  name: 'df_ens_resolve',
  description: 'Resolve an ENS name to an Ethereum address using on-chain lookup via viem.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      name: {
        type: 'string',
        description: 'ENS name to resolve (e.g., "alice.fairdata.eth" or "vitalik.eth")',
      },
      rpc_url: {
        type: 'string',
        description: 'Ethereum mainnet RPC URL',
      },
    },
    required: ['name'],
  },
  async execute(args: { name: string; rpc_url?: string }) {
    const { createPublicClient, http } = await import('viem')
    const { mainnet } = await import('viem/chains')
    const { normalize } = await import('viem/ens')

    const rpcUrl = args.rpc_url || process.env.ETH_RPC_URL || 'https://ethereum.publicnode.com'
    const client = createPublicClient({ chain: mainnet, transport: http(rpcUrl) })

    const ensName = normalize(args.name)
    const address = await client.getEnsAddress({ name: ensName })

    return {
      name: args.name,
      normalized: ensName,
      address: address || null,
      resolved: !!address,
    }
  },
}
