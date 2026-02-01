/**
 * Contract addresses and network configuration.
 *
 * Base is the primary network for escrow + payments.
 * ERC-8004 is on Sepolia until mainnet deployment.
 */

export interface NetworkConfig {
  rpcUrl: string;
  chainId: number;
  escrowAddress: string;
  tokens: Record<string, string>;
}

// Base mainnet tokens
export const TOKENS = {
  NATIVE: '0x0000000000000000000000000000000000000000',
  USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',  // Base USDC
  USDT: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',  // Base USDT
} as const;

// Deployed contract addresses
export const ADDRESSES = {
  base: {
    rpcUrl: 'https://mainnet.base.org',
    chainId: 8453,
    escrowAddress: '0xDd4396d4F28d2b513175ae17dE11e56a898d19c3',
    tokens: TOKENS,
  },
  baseSepolia: {
    rpcUrl: 'https://sepolia.base.org',
    chainId: 84532,
    escrowAddress: '0xa226C0E0cEa2D8353C9Ec6ee959A03D54F8D14b6',
    tokens: {
      NATIVE: TOKENS.NATIVE,
      USDC: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',  // Base Sepolia USDC
      USDT: TOKENS.NATIVE,  // No testnet USDT
    },
  },
  // ERC-8004 registries (Sepolia)
  erc8004: {
    rpcUrl: 'https://rpc.sepolia.org',
    chainId: 11155111,
    identityRegistry: '0x7177a6867296406881E20d6647232314736Dd09A',
    reputationRegistry: '0xB5048e3ef1DA4E04deB6f7d0423D06F63869e322',
    validationRegistry: '0x662b40A526cb4017d947e71eAF6753BF3eeE66d8',
  },
} as const;
