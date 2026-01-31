/**
 * Unified discovery search.
 *
 * Merges results from all 4 channels:
 * 1. On-chain (EscrowCreated events)
 * 2. Moltbook (r/datamarket posts)
 * 3. ERC-8004 (capability search)
 * 4. x402 Bazaar (future)
 *
 * All results are sanitized before returning to prevent prompt injection.
 * Results are deduplicated by escrowId and ranked by reputation.
 */

import { type SanitizedOffering } from './sanitize.js';
import { OnChainChannel } from './channels/onchain.js';
import { MoltbookChannel } from './channels/moltbook.js';
import { ERC8004Channel } from './channels/erc8004.js';
import { DataEscrow } from '@fairdrop/contracts';

export interface SearchParams {
  /** Free-text query (matched against title, description, tags) */
  query?: string;
  /** Category filter (exact match on indexed category) */
  category?: string;
  /** Seller address filter */
  seller?: string;
  /** Maximum total results */
  maxResults?: number;
  /** Minimum reputation score (0-100) */
  minReputation?: number;
  /** Only show fast-settle escrows */
  fastSettleOnly?: boolean;
  /** Channels to search (default: all) */
  channels?: Array<'onchain' | 'moltbook' | 'erc8004' | 'x402'>;
}

export interface SearchResult {
  offerings: SanitizedOffering[];
  bounties: SanitizedOffering[];
  total: number;
  channels: {
    onchain: number;
    moltbook: number;
    erc8004: number;
    x402: number;
  };
}

export class Discovery {
  private onchain: OnChainChannel;
  private moltbook: MoltbookChannel;
  private erc8004: ERC8004Channel;

  constructor(config?: {
    escrow?: DataEscrow;
    beeUrl?: string;
    moltbookApiKey?: string;
  }) {
    const escrow = config?.escrow || new DataEscrow();
    this.onchain = new OnChainChannel(escrow, config?.beeUrl);
    this.moltbook = new MoltbookChannel({ apiKey: config?.moltbookApiKey });
    this.erc8004 = new ERC8004Channel();
  }

  /**
   * Search across all discovery channels.
   * Returns deduplicated, sanitized, reputation-ranked results.
   */
  async search(params: SearchParams = {}): Promise<SearchResult> {
    const channels = params.channels || ['onchain', 'moltbook', 'erc8004'];
    const maxResults = params.maxResults || 50;

    // Query all channels in parallel
    const [onchainResults, moltbookResults, erc8004Results] = await Promise.allSettled([
      channels.includes('onchain')
        ? this.onchain.search({ category: params.category, seller: params.seller })
        : Promise.resolve([]),
      channels.includes('moltbook') && params.query
        ? this.moltbook.search(params.query)
        : Promise.resolve([]),
      channels.includes('erc8004') && params.category
        ? this.erc8004.search(params.category)
        : Promise.resolve([]),
    ]);

    // Collect results, handling failures gracefully
    const all: SanitizedOffering[] = [
      ...(onchainResults.status === 'fulfilled' ? onchainResults.value : []),
      ...(moltbookResults.status === 'fulfilled' ? moltbookResults.value : []),
      ...(erc8004Results.status === 'fulfilled' ? erc8004Results.value : []),
    ];

    // Deduplicate by escrowId (prefer on-chain as source of truth)
    const seen = new Set<string>();
    const deduped = all.filter(offering => {
      if (!offering.id || seen.has(offering.id)) return false;
      seen.add(offering.id);
      return true;
    });

    // Apply filters
    let filtered = deduped;

    if (params.query) {
      const q = params.query.toLowerCase();
      filtered = filtered.filter(o =>
        o.title.toLowerCase().includes(q) ||
        o.description.toLowerCase().includes(q) ||
        o.tags.some(t => t.toLowerCase().includes(q)) ||
        o.category.toLowerCase().includes(q),
      );
    }

    if (params.minReputation) {
      filtered = filtered.filter(o =>
        o.reputation && o.reputation.score >= params.minReputation!,
      );
    }

    if (params.fastSettleOnly) {
      filtered = filtered.filter(o => o.fastSettle);
    }

    // Rank by reputation (highest first), then by recency
    filtered.sort((a, b) => {
      const repA = a.reputation?.score || 0;
      const repB = b.reputation?.score || 0;
      if (repA !== repB) return repB - repA;
      return (b.expiresAt || 0) - (a.expiresAt || 0);
    });

    // Trim to max results
    const offerings = filtered.slice(0, maxResults);

    // Count by channel
    const channelCounts = {
      onchain: offerings.filter(o => o.source === 'onchain').length,
      moltbook: offerings.filter(o => o.source === 'moltbook').length,
      erc8004: offerings.filter(o => o.source === 'erc8004').length,
      x402: offerings.filter(o => o.source === 'x402').length,
    };

    return {
      offerings,
      bounties: [], // TODO: separate bounty search
      total: offerings.length,
      channels: channelCounts,
    };
  }

  /**
   * Post an offering to Moltbook for social discovery.
   */
  async announce(offering: Parameters<MoltbookChannel['postOffering']>[0]) {
    return this.moltbook.postOffering(offering);
  }

  /**
   * Post a bounty to Moltbook.
   */
  async postBounty(bounty: Parameters<MoltbookChannel['postBounty']>[0]) {
    return this.moltbook.postBounty(bounty);
  }
}
