/**
 * On-chain discovery channel.
 *
 * Queries EscrowCreated events from the DataEscrow contract.
 * Uses indexed category field for efficient filtering.
 * Resolves metadataHash from Swarm for title/description/tags.
 */

import { ethers } from 'ethers';
import { DataEscrow } from '@fairdrop/contracts';
import { sanitize, type SanitizedOffering } from '../sanitize.js';

export interface OnChainSearchParams {
  category?: string;
  seller?: string;
  maxResults?: number;
  /** Swarm gateway for resolving metadata */
  beeUrl?: string;
}

export class OnChainChannel {
  private escrow: DataEscrow;
  private beeUrl: string;

  constructor(escrow: DataEscrow, beeUrl?: string) {
    this.escrow = escrow;
    this.beeUrl = beeUrl || process.env.BEE_URL || 'https://gateway.fairdrop.xyz';
  }

  async search(params: OnChainSearchParams = {}): Promise<SanitizedOffering[]> {
    const events = await this.escrow.queryEscrows({
      category: params.category,
      seller: params.seller,
    });

    const results: SanitizedOffering[] = [];

    for (const event of events.slice(0, params.maxResults || 50)) {
      // Resolve metadata from Swarm if available
      let metadata: Record<string, unknown> = {};
      if (event.metadataHash && event.metadataHash !== ethers.ZeroHash) {
        try {
          metadata = await this.resolveMetadata(event.metadataHash);
        } catch {
          // Metadata resolution failed — continue with on-chain data only
        }
      }

      results.push(sanitize({
        ...event,
        ...metadata,
        priceWei: event.amount,
      }, 'onchain'));
    }

    return results;
  }

  private async resolveMetadata(metadataHash: string): Promise<Record<string, unknown>> {
    // metadataHash is the Swarm reference (bytes32)
    const ref = metadataHash.replace(/^0x/, '');
    const response = await fetch(`${this.beeUrl}/bzz/${ref}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return {};
    return await response.json();
  }
}
