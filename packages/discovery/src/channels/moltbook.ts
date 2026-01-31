/**
 * Moltbook discovery channel.
 *
 * Searches r/datamarket submolt for data offerings.
 * Auto-posts new offerings when creating escrows.
 *
 * SECURITY: All Moltbook content is treated as untrusted.
 * Only structured fields are extracted — free-text body is NEVER
 * passed to agent context (prompt injection prevention per M2).
 */

import { sanitize, type SanitizedOffering } from '../sanitize.js';

const MOLTBOOK_API = 'https://api.moltbook.com/v1';
const DATAMARKET_SUBMOLT = 'datamarket';

export interface MoltbookConfig {
  apiKey?: string;
  submolt?: string;
}

export class MoltbookChannel {
  private apiKey: string;
  private submolt: string;

  constructor(config: MoltbookConfig = {}) {
    this.apiKey = config.apiKey || process.env.MOLTBOOK_API_KEY || '';
    this.submolt = config.submolt || DATAMARKET_SUBMOLT;
  }

  /**
   * Search Moltbook for data offerings.
   * Extracts only structured fields from posts.
   */
  async search(query: string, maxResults = 20): Promise<SanitizedOffering[]> {
    if (!this.apiKey) return [];

    try {
      const response = await fetch(
        `${MOLTBOOK_API}/submolts/${this.submolt}/posts?q=${encodeURIComponent(query)}&limit=${maxResults}`,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Accept': 'application/json',
          },
          signal: AbortSignal.timeout(5000),
        },
      );

      if (!response.ok) return [];
      const data = await response.json() as { posts: MoltbookPost[] };

      return data.posts
        .filter(post => post.metadata?.escrowId) // Only posts with escrow data
        .map(post => sanitize({
          id: post.metadata.escrowId,
          seller: post.metadata.seller,
          category: post.metadata.category,
          priceWei: post.metadata.priceWei,
          priceFormatted: post.metadata.priceFormatted,
          paymentToken: post.metadata.paymentToken,
          contentHash: post.metadata.contentHash,
          expectedDataHash: post.metadata.expectedDataHash,
          fastSettle: post.metadata.fastSettle,
          expiresAt: post.metadata.expiresAt,
          // Extract structured fields only — never the body text
          title: post.metadata.title,
          description: post.metadata.description,
          tags: post.metadata.tags,
          reputation: post.metadata.reputation,
        }, 'moltbook'));
    } catch {
      return []; // Graceful degradation
    }
  }

  /**
   * Post a new offering to Moltbook.
   * Called automatically after escrow creation.
   */
  async postOffering(offering: {
    escrowId: string;
    seller: string;
    title: string;
    description: string;
    category: string;
    priceFormatted: string;
    paymentToken: string;
    tags: string[];
    contentHash: string;
    fastSettle: boolean;
    expiresAt: number;
    reputation?: { score: number; feedbackCount: number; deliveries: number };
  }): Promise<{ postId: string } | null> {
    if (!this.apiKey) return null;

    try {
      const response = await fetch(
        `${MOLTBOOK_API}/submolts/${this.submolt}/posts`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            title: `[${offering.category}] ${offering.title} — ${offering.priceFormatted} ${offering.paymentToken}`,
            // Body is human/agent readable but metadata is the source of truth
            body: [
              `**${offering.title}**`,
              offering.description,
              '',
              `Price: ${offering.priceFormatted} ${offering.paymentToken}`,
              `Category: ${offering.category}`,
              `Escrow: ${offering.escrowId}`,
              offering.fastSettle ? 'Fast settlement enabled' : 'Standard settlement (24h dispute window)',
              offering.reputation ? `Seller reputation: ${offering.reputation.score}/100 (${offering.reputation.feedbackCount} reviews)` : '',
              '',
              `Tags: ${offering.tags.join(', ')}`,
            ].filter(Boolean).join('\n'),
            // Structured metadata for machine consumption
            metadata: {
              type: 'data-offering',
              ...offering,
            },
          }),
          signal: AbortSignal.timeout(10000),
        },
      );

      if (!response.ok) return null;
      const result = await response.json() as { id: string };
      return { postId: result.id };
    } catch {
      return null; // Non-critical failure
    }
  }

  /**
   * Post a bounty/requirement to Moltbook.
   */
  async postBounty(bounty: {
    title: string;
    description: string;
    category: string;
    rewardFormatted: string;
    paymentToken: string;
    tags: string[];
    buyer: string;
    expiresAt: number;
  }): Promise<{ postId: string } | null> {
    if (!this.apiKey) return null;

    try {
      const response = await fetch(
        `${MOLTBOOK_API}/submolts/${this.submolt}/posts`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            title: `[BOUNTY] ${bounty.title} — ${bounty.rewardFormatted} ${bounty.paymentToken}`,
            body: [
              `**BOUNTY: ${bounty.title}**`,
              bounty.description,
              '',
              `Reward: ${bounty.rewardFormatted} ${bounty.paymentToken}`,
              `Category: ${bounty.category}`,
              `Expires: ${new Date(bounty.expiresAt * 1000).toISOString()}`,
              '',
              `Tags: ${bounty.tags.join(', ')}`,
            ].join('\n'),
            metadata: {
              type: 'data-bounty',
              ...bounty,
            },
          }),
          signal: AbortSignal.timeout(10000),
        },
      );

      if (!response.ok) return null;
      const result = await response.json() as { id: string };
      return { postId: result.id };
    } catch {
      return null;
    }
  }
}

interface MoltbookPost {
  id: string;
  title: string;
  body: string;
  metadata: Record<string, any>;
  author: string;
  created: string;
}
