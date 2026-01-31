/**
 * Skill configuration.
 * Auto-populated on first run, persisted in skill data directory.
 */

export interface SkillConfig {
  /** Encrypted wallet keystore path */
  keystorePath: string;
  /** Swarm bee URL */
  beeUrl: string;
  /** Fairdrop API for stamps and gas */
  fairdropApi: string;
  /** Current postage batch ID (shared or individual) */
  stampBatchId: string;
  /** ERC-8004 agent ID (set after registration) */
  agentId?: string;
  /** Moltbook API key (optional) */
  moltbookApiKey?: string;
  /** Auto-approve transactions below this USDC amount */
  autoApproveBelow: number;
  /** Base RPC URL */
  baseRpcUrl: string;
}

export const DEFAULT_CONFIG: SkillConfig = {
  keystorePath: '.fairdrop-wallet.json',
  beeUrl: process.env.BEE_URL || 'https://gateway.fairdrop.xyz',
  fairdropApi: process.env.FAIRDROP_API || 'https://api.fairdrop.xyz',
  stampBatchId: '',
  moltbookApiKey: process.env.MOLTBOOK_API_KEY || '',
  autoApproveBelow: 5, // USDC
  baseRpcUrl: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
};
