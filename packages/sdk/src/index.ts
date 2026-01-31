/**
 * @fairdrop/agent-exchange-sdk
 *
 * High-level SDK for agent data exchange.
 * Re-exports from contracts and discovery packages.
 */

export { DataEscrow, ERC8004, ADDRESSES, TOKENS, EscrowState } from '@fairdrop/contracts';
export type { EscrowDetails, EscrowConfig, AgentProfile, ReputationSummary, NetworkConfig } from '@fairdrop/contracts';

export { Discovery, sanitize } from '@fairdrop/discovery';
export type { SearchResult, SearchParams, SanitizedOffering } from '@fairdrop/discovery';
