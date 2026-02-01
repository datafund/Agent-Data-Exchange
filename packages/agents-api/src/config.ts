/**
 * Configuration for the agents API service
 */

export interface ChainConfig {
  chainId: number
  name: string
  rpcUrl: string
  escrowContract: `0x${string}`
  startBlock: bigint
  confirmations: number
}

export interface Config {
  port: number
  dbPath: string
  chains: ChainConfig[]
  pollIntervalMs: number
  catchupBatchSize: number
}

export function loadConfig(): Config {
  const chains: ChainConfig[] = []

  // Base mainnet
  if (process.env.BASE_RPC_URL && process.env.BASE_ESCROW_CONTRACT) {
    chains.push({
      chainId: 8453,
      name: 'base',
      rpcUrl: process.env.BASE_RPC_URL,
      escrowContract: process.env.BASE_ESCROW_CONTRACT as `0x${string}`,
      startBlock: BigInt(process.env.BASE_START_BLOCK || '0'),
      confirmations: 2,
    })
  }

  // Sepolia testnet
  if (process.env.SEPOLIA_RPC_URL && process.env.SEPOLIA_ESCROW_CONTRACT) {
    chains.push({
      chainId: 11155111,
      name: 'sepolia',
      rpcUrl: process.env.SEPOLIA_RPC_URL,
      escrowContract: process.env.SEPOLIA_ESCROW_CONTRACT as `0x${string}`,
      startBlock: BigInt(process.env.SEPOLIA_START_BLOCK || '0'),
      confirmations: 2,
    })
  }

  return {
    port: parseInt(process.env.PORT || '3003', 10),
    dbPath: process.env.DB_PATH || './data/agents.db',
    chains,
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '12000', 10),
    catchupBatchSize: parseInt(process.env.CATCHUP_BATCH_SIZE || '1000', 10),
  }
}
