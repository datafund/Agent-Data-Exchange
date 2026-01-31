/**
 * ERC-8004 discovery channel.
 *
 * Searches the agent identity + reputation registries
 * for agents with matching capabilities.
 */

import { ethers, JsonRpcProvider } from 'ethers';
import { ERC8004 } from '@fairdrop/contracts';
import { sanitize, type SanitizedOffering } from '../sanitize.js';
import { ADDRESSES } from '@fairdrop/contracts';

export class ERC8004Channel {
  private erc8004: ERC8004;

  constructor(provider?: ethers.Provider) {
    const p = provider || new JsonRpcProvider(
      process.env.ERC8004_RPC_URL || ADDRESSES.erc8004.rpcUrl,
    );
    this.erc8004 = new ERC8004(p);
  }

  /**
   * Search for agents offering a specific capability.
   * Returns agent profiles enriched with reputation.
   */
  async search(capability: string): Promise<SanitizedOffering[]> {
    try {
      const agentIds = await this.erc8004.findByCapability(capability);
      const results: SanitizedOffering[] = [];

      for (const agentId of agentIds.slice(0, 20)) {
        try {
          const [profileURI, reputation] = await Promise.all([
            this.erc8004.getProfile(agentId),
            this.erc8004.getReputation(agentId),
          ]);

          // Parse profile
          let profile: Record<string, unknown> = {};
          if (profileURI.startsWith('data:application/json,')) {
            profile = JSON.parse(decodeURIComponent(profileURI.slice(22)));
          }

          results.push(sanitize({
            id: `erc8004-${agentId}`,
            seller: '', // Would need ownerOf lookup
            category: capability,
            title: profile.name || `Agent #${agentId}`,
            description: profile.description || '',
            tags: profile.capabilities || profile.tags || [],
            reputation: {
              score: reputation.averageScore,
              feedbackCount: reputation.count,
              deliveries: reputation.successfulDeliveries,
            },
            // ERC-8004 results don't have pricing — they're agent profiles
            // The agent would need a separate escrow lookup
            priceWei: '0',
            priceFormatted: 'Contact agent',
            paymentToken: '',
            contentHash: '',
            expectedDataHash: '',
            fastSettle: false,
            expiresAt: 0,
          }, 'erc8004'));
        } catch {
          // Skip agents with unresolvable profiles
        }
      }

      return results;
    } catch {
      return [];
    }
  }
}
