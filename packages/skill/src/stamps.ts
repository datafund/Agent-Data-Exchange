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
   * Sleep helper for retry backoff.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Request a shared stamp from Fairdrop API.
   * Rate limited server-side to prevent abuse.
   * Includes retry logic with exponential backoff for transient errors (502/503/504).
   */
  private async requestSharedStamp(retries = 3): Promise<StampInfo> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const response = await fetch(`${this.fairdropApi}/api/free-stamp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            timestamp: Date.now(),
            accountId: 'openclaw-agent', // TODO: use actual agent ID
          }),
          signal: AbortSignal.timeout(10000),
        });

        if (response.ok) {
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

        // Handle specific error codes
        if (response.status === 429) {
          throw new Error(
            'Stamp rate limit reached. Consider getting an individual stamp via mcp.id.fairdatasociety.org',
          );
        }

        // Transient server errors - retry with exponential backoff
        if (response.status === 502 || response.status === 503 || response.status === 504) {
          lastError = new Error(`Stamp API returned ${response.status}`);
          if (attempt < retries - 1) {
            const backoffMs = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
            console.warn(`[fairdrop] Stamp API ${response.status}, retrying in ${backoffMs}ms...`);
            await this.sleep(backoffMs);
            continue;
          }
        }

        // Non-transient error - don't retry
        throw new Error(`Failed to get stamp: ${response.status}`);
      } catch (e) {
        lastError = e as Error;

        // Don't retry for rate limits or non-transient errors
        if (lastError.message.includes('rate limit') || lastError.message.includes('Failed to get stamp')) {
          throw lastError;
        }

        // Retry for network errors and timeouts
        if (attempt < retries - 1) {
          const backoffMs = Math.pow(2, attempt) * 1000;
          console.warn(`[fairdrop] Stamp request failed, retrying in ${backoffMs}ms:`, lastError.message);
          await this.sleep(backoffMs);
        }
      }
    }

    throw new Error(`Stamp API unavailable after ${retries} attempts: ${lastError?.message}`);
  }

  /**
   * Check if current stamp has capacity for a given upload size.
   */
  hasCapacity(bytes: number): boolean {
    if (!this.currentStamp) return false;
    return this.currentStamp.remainingCapacity >= bytes;
  }
}
