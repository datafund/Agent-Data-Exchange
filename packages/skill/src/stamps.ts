/**
 * Stamp management.
 *
 * v1: Shared stamp from api.fairdrop.xyz (zero friction)
 * v2: Individual stamps via mcp.id.fairdatasociety.org
 *
 * Per evaluation M4:
 * - 10MB/day rate limit on shared stamp
 * - Auto-topup monitoring
 * - Graceful degradation when exhausted
 */

export interface StampInfo {
  batchId: string;
  expiresAt: number;
  remainingCapacity: number;
  totalCapacity: number;
  type: 'shared' | 'individual';
}

export class Stamps {
  private fairdropApi: string;
  private currentStamp: StampInfo | null = null;

  constructor(fairdropApi: string) {
    this.fairdropApi = fairdropApi;
  }

  /**
   * Get a usable stamp. Requests shared stamp if none available.
   */
  async getStamp(): Promise<StampInfo> {
    if (this.currentStamp && this.currentStamp.expiresAt > Date.now()) {
      return this.currentStamp;
    }

    this.currentStamp = await this.requestSharedStamp();
    return this.currentStamp;
  }

  /**
   * Request a shared stamp from Fairdrop API.
   * Rate limited server-side to prevent abuse.
   */
  private async requestSharedStamp(): Promise<StampInfo> {
    const response = await fetch(`${this.fairdropApi}/api/free-stamp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timestamp: Date.now(),
        accountId: 'openclaw-agent', // TODO: use actual agent ID
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error(
          'Stamp rate limit reached. Consider getting an individual stamp via mcp.id.fairdatasociety.org',
        );
      }
      throw new Error(`Failed to get stamp: ${response.status}`);
    }

    const data = await response.json() as {
      batchId: string;
      expiresAt: number;
      depth: number;
      remainingCapacity: number;
      totalCapacity: number;
      upgradeAvailable?: boolean;
    };

    if (data.upgradeAvailable) {
      console.error('[fairdrop] Individual stamps now available! Run `clawhub update fairdrop` for better storage.');
    }

    return {
      batchId: data.batchId,
      expiresAt: data.expiresAt,
      remainingCapacity: data.remainingCapacity || 10_000_000, // 10MB default
      totalCapacity: data.totalCapacity || 10_000_000,
      type: 'shared',
    };
  }

  /**
   * Check if current stamp has capacity for a given upload size.
   */
  hasCapacity(bytes: number): boolean {
    if (!this.currentStamp) return false;
    return this.currentStamp.remainingCapacity >= bytes;
  }
}
