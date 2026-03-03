/**
 * @fairdrop/agent-exchange-sdk
 *
 * High-level SDK for agent data exchange.
 * Re-exports from contracts and discovery packages.
 */

export { DataEscrow, ERC8004, ADDRESSES, TOKENS, EscrowState } from '@ade/contracts';
export type { EscrowDetails, EscrowConfig, AgentProfile, ReputationSummary, NetworkConfig } from '@ade/contracts';

export { Discovery, sanitize } from '@fairdrop/discovery';
export type { SearchResult, SearchParams, SanitizedOffering } from '@fairdrop/discovery';

export * from './x402.js';
