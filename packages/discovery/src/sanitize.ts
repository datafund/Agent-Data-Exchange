/**
 * Discovery result sanitization.
 *
 * Per evaluation mitigation M2: all discovery results passed to agent context
 * go through strict sanitization. Only structured fields are extracted.
 * Free-text is NEVER passed to the LLM.
 *
 * This prevents prompt injection via malicious metadata in:
 * - Moltbook posts
 * - On-chain metadataURI content
 * - ERC-8004 agent profiles
 */

export interface SanitizedOffering {
  /** Unique identifier (escrowId or offering hash) */
  id: string;
  /** Seller address (hex) */
  seller: string;
  /** Category (from indexed bytes32) */
  category: string;
  /** Price in wei */
  priceWei: string;
  /** Price formatted (e.g., "0.5 USDC") */
  priceFormatted: string;
  /** Payment token symbol */
  paymentToken: string;
  /** Data hash for verification */
  contentHash: string;
  /** Expected data hash (if set by seller) */
  expectedDataHash: string;
  /** Whether fast settlement is enabled */
  fastSettle: boolean;
  /** Expiry timestamp */
  expiresAt: number;
  /** Discovery source */
  source: 'onchain' | 'moltbook' | 'erc8004' | 'x402';
  /** Seller reputation (if available) */
  reputation?: {
    score: number;
    feedbackCount: number;
    deliveries: number;
  };
  /** Sanitized title (max 100 chars, stripped) */
  title: string;
  /** Sanitized description (max 300 chars, stripped) */
  description: string;
  /** Sanitized tags (max 10, alphanumeric only) */
  tags: string[];
}

// Maximum field lengths
const MAX_TITLE = 100;
const MAX_DESCRIPTION = 300;
const MAX_TAGS = 10;
const MAX_TAG_LENGTH = 30;

/**
 * Sanitize a raw offering from any source into a safe structured format.
 * Strips all potential injection vectors.
 */
export function sanitize(raw: Record<string, unknown>, source: SanitizedOffering['source']): SanitizedOffering {
  return {
    id: sanitizeHex(raw.id || raw.escrowId || ''),
    seller: sanitizeAddress(raw.seller || ''),
    category: sanitizeAlphanumeric(raw.category || '', 50),
    priceWei: sanitizeNumeric(raw.priceWei || raw.price_wei || raw.amount || '0'),
    priceFormatted: sanitizeAlphanumeric(raw.priceFormatted || raw.price_eth || '', 20),
    paymentToken: sanitizeAlphanumeric(raw.paymentToken || 'ETH', 10),
    contentHash: sanitizeHex(raw.contentHash || raw.dataHash || ''),
    expectedDataHash: sanitizeHex(raw.expectedDataHash || ''),
    fastSettle: Boolean(raw.fastSettle),
    expiresAt: sanitizeTimestamp(raw.expiresAt),
    source,
    reputation: sanitizeReputation(raw.reputation),
    title: sanitizeText(raw.title || '', MAX_TITLE),
    description: sanitizeText(raw.description || '', MAX_DESCRIPTION),
    tags: sanitizeTags(raw.tags),
  };
}

// ============ Sanitizers ============

function sanitizeText(input: unknown, maxLength: number): string {
  if (typeof input !== 'string') return '';
  // Strip everything except basic alphanumeric, spaces, and punctuation
  return input
    .replace(/[^\w\s.,!?()-]/g, '')
    .trim()
    .slice(0, maxLength);
}

function sanitizeHex(input: unknown): string {
  if (typeof input !== 'string') return '';
  const match = input.match(/^(0x)?[0-9a-fA-F]+$/);
  return match ? input : '';
}

function sanitizeAddress(input: unknown): string {
  if (typeof input !== 'string') return '';
  const match = input.match(/^0x[0-9a-fA-F]{40}$/);
  return match ? input : '';
}

function sanitizeNumeric(input: unknown): string {
  const str = String(input);
  const match = str.match(/^\d+$/);
  return match ? str : '0';
}

function sanitizeAlphanumeric(input: unknown, maxLength: number): string {
  if (typeof input !== 'string') return '';
  return input.replace(/[^\w.-]/g, '').slice(0, maxLength);
}

function sanitizeTimestamp(input: unknown): number {
  const num = Number(input);
  if (isNaN(num) || num < 0 || num > 2e12) return 0;
  return Math.floor(num);
}

function sanitizeTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((t): t is string => typeof t === 'string')
    .map(t => t.replace(/[^\w-]/g, '').slice(0, MAX_TAG_LENGTH))
    .filter(t => t.length > 0)
    .slice(0, MAX_TAGS);
}

function sanitizeReputation(input: unknown): SanitizedOffering['reputation'] | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const rep = input as Record<string, unknown>;
  const score = Number(rep.score || rep.averageScore || 0);
  const count = Number(rep.feedbackCount || rep.count || rep.totalFeedback || 0);
  const deliveries = Number(rep.deliveries || rep.successfulDeliveries || 0);
  if (score < 0 || score > 100 || isNaN(score)) return undefined;
  return { score, feedbackCount: count, deliveries };
}
