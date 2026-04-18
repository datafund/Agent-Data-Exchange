# Agent Data Exchange - Issue Resolution Plan

## Executive Summary

Analysis of 17 open issues (excluding #10 - wallet integration). Key findings:
- Skills API **exists** at `packages/agents-api/src/api/routes/skills.ts`
- `formatPrice()` already converts wei→ETH in `wallets.js`
- Several issues are deployment gaps, not code gaps
- The `skill.ts` encryption issue is real and critical

## Issue Status Matrix

| # | Title | Priority | Status | Resolution |
|---|-------|----------|--------|------------|
| **#39** | Encryption key handling broken | **P0** | Code needed | Fix skill.ts encryption flow |
| **#17** | Bounties auth bypass | **P0** | Code needed | Add `verifySignature` to ALL mutation endpoints |
| **#27** | Add revert reasons to contract | **P0** | Code needed | Add require() messages (enables debugging) |
| **#11** | Misleading 'sold_out' status | **P1** | Code needed | Return 'not_listed' instead |
| **#9** | Skills have no escrows | **P1** | Code needed | Improve skill→escrow linking |
| **#24** | CLI registry redirect issue | **P1** | Code needed | Fix HTTP redirect handling (quick fix) |
| **#12** | No availability indicator | **P2** | Code needed | Add status badge to cards |
| **#16** | Inconsistent /skill vs /skills | **P2** | Code needed | Add API route redirect |
| **#22** | fairdrop.xyz 502 errors | **P2** | Code needed | Add retry logic + server monitoring |
| **#15** | Docs not on main site | **P2** | Code needed | Add /docs route |
| **#30** | Add --dry-run to CLI publish | **P3** | Code needed | Add confirmation/dry-run flags |
| **#18** | Duplicate skill entries | **P3** | Decision | Allow with seller differentiation |
| **#21** | Price shows wei not ETH | **Resolved** | Deploy | `formatPrice()` exists - verify deployment |
| **#23** | REST API for escrow creation | **Resolved** | Close | PR #38 added `/api/v1/escrows` |
| **#14** | skill-exchange not in registry | **Deferred** | Launch | Will publish at product launch |
| **#13** | MCP server unreachable | **Blocked** | Infra | Needs server-side investigation |

## Dependency Graph

```
#27 (revert reasons) ─┬─► #39 (encryption) ─► #9 (skill-escrow linking)
                      │                            │
#17 (auth bypass) ────┘                            ▼
                                              #11 (status fix)
                                                   │
                                                   ▼
                                              #12 (availability badge)
```

---

## Detailed Implementation Plans

### Phase 1: Critical Fixes (P0)

**Implementation order follows dependency graph: #27 → #17 → #39 → #24**

#### #27 - Add Descriptive Revert Reasons (P0 - Do First)

**Problem**: Contract reverts with empty data, making debugging of all other issues difficult.

**Files**:
- Locate contract: `npm ls @fairdrop/contracts` in the repo
- Contract file: `DataEscrowV3.sol`

**Security Note**: Use error codes instead of verbose messages to avoid information disclosure.

**Implementation**:

```solidity
// Error code reference (document in NatSpec):
/// @dev E01: Seller not registered
/// @dev E02: Invalid expiry (must be 1-365 days)
/// @dev E03: Amount below minimum
/// @dev E04: Content hash required
/// @dev E05: Key commitment required
/// @dev E06: Invalid escrow state
/// @dev E07: Unauthorized (not seller/buyer)
/// @dev E08: Key does not match commitment
/// @dev E09: Escrow expired
/// @dev E10: Already funded

// Key validations:
require(sellers[msg.sender].registered, "E01");
require(expiryDays >= 1 && expiryDays <= 365, "E02");
require(amount >= MIN_ESCROW_AMOUNT, "E03");
require(contentHash != bytes32(0), "E04");
require(keyCommitment != bytes32(0), "E05");
require(escrows[escrowId].state == State.Created, "E06");
require(escrows[escrowId].seller == msg.sender, "E07");
require(keccak256(abi.encodePacked(key, salt)) == escrows[escrowId].keyCommitment, "E08");
```

**Client-side error mapping** (add to SDK - `packages/contracts/src/errors.ts`):
```typescript
export const CONTRACT_ERRORS: Record<string, string> = {
  'E01': 'Seller not registered as agent',
  'E02': 'Expiry must be between 1 and 365 days',
  'E03': 'Amount is below the minimum threshold',
  'E04': 'Content hash is required',
  'E05': 'Key commitment is required',
  'E06': 'Invalid escrow state for this operation',
  'E07': 'Unauthorized: not seller or buyer',
  'E08': 'Key does not match commitment',
  'E09': 'Escrow has expired',
  'E10': 'Escrow already funded',
};

export function decodeContractError(error: string): string {
  const match = error.match(/E\d{2}/);
  return match ? CONTRACT_ERRORS[match[0]] || error : error;
}
```

---

#### #39 - Fix Encryption Key Handling in skill.ts (P0)

**Problem**: The `sell()` function has three critical issues:
1. Encryption key generated but never stored
2. Uses Swarm-native encryption (key embedded in reference - defeats escrow)
3. Key commitment computed from unused key

**Files**:
- `packages/skill/src/skill.ts` (main fix)
- `packages/skill/src/key-store.ts` (new file)

**Implementation**:

```typescript
// ============ NEW FILE: packages/skill/src/key-store.ts ============
import {
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  chmodSync,
  renameSync,
  unlinkSync,
  readdirSync,
  statSync,
} from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface EscrowKeyData {
  key: string;      // hex-encoded
  salt: string;     // hex-encoded
  swarmRef: string;
  createdAt: number;
}

export interface EscrowKeyStore {
  save(escrowId: string, key: Uint8Array, salt: Uint8Array, swarmRef: string): Promise<void>;
  get(escrowId: string): Promise<EscrowKeyData | null>;
  delete(escrowId: string): Promise<void>;
}

/**
 * File-based key storage with atomic writes and restricted permissions.
 * Keys are stored in ~/.fairdrop/escrow-keys/ with mode 0600.
 *
 * SECURITY NOTE: Keys are stored unencrypted. File permissions (0600) provide
 * OS-level protection. For higher security, consider:
 * - OS keychain integration (see ade CLI's escrow-keys.ts)
 * - Password-derived encryption key
 * - Hardware security module (HSM) for production
 */
export class FileKeyStore implements EscrowKeyStore {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? join(homedir(), '.fairdrop', 'escrow-keys');
    mkdirSync(this.baseDir, { recursive: true, mode: 0o700 });
    this.cleanupStaleTemp(); // Clean orphan .tmp files on startup
  }

  private keyPath(escrowId: string): string {
    // Sanitize escrowId to prevent path traversal (must be numeric)
    if (!/^\d+$/.test(escrowId)) {
      throw new Error('Invalid escrowId format: must be numeric');
    }
    return join(this.baseDir, `${escrowId}.json`);
  }

  // Clean up orphan .tmp files older than 5 minutes
  private cleanupStaleTemp(): void {
    try {
      const files = readdirSync(this.baseDir);
      const now = Date.now();
      for (const file of files) {
        if (file.endsWith('.tmp')) {
          const path = join(this.baseDir, file);
          const stat = statSync(path);
          if (now - stat.mtimeMs > 5 * 60 * 1000) {
            unlinkSync(path);
          }
        }
      }
    } catch { /* ignore cleanup errors */ }
  }

  async save(escrowId: string, key: Uint8Array, salt: Uint8Array, swarmRef: string): Promise<void> {
    // Validate key and salt are exactly 32 bytes
    if (key.length !== 32 || salt.length !== 32) {
      throw new Error('Key and salt must be exactly 32 bytes');
    }

    const data: EscrowKeyData = {
      key: Buffer.from(key).toString('hex'),
      salt: Buffer.from(salt).toString('hex'),
      swarmRef,
      createdAt: Date.now(),
    };
    const path = this.keyPath(escrowId);
    const tempPath = `${path}.tmp`;

    // Atomic write: write to temp, then rename
    writeFileSync(tempPath, JSON.stringify(data, null, 2), { mode: 0o600 });
    chmodSync(tempPath, 0o600); // Ensure permissions even if umask is permissive
    renameSync(tempPath, path);
  }

  async get(escrowId: string): Promise<EscrowKeyData | null> {
    const path = this.keyPath(escrowId);
    if (!existsSync(path)) return null;
    const content = readFileSync(path, 'utf-8');
    return JSON.parse(content) as EscrowKeyData;
  }

  async delete(escrowId: string): Promise<void> {
    const path = this.keyPath(escrowId);
    if (existsSync(path)) {
      try {
        unlinkSync(path);
      } catch (e) {
        console.warn(`Failed to delete key file ${path}:`, e);
      }
    }
  }
}

// ============ CHANGES TO: packages/skill/src/skill.ts ============

import { webcrypto as crypto } from 'crypto'; // Node.js 15+ Web Crypto API
import { FileKeyStore, type EscrowKeyStore } from './key-store.js';

export class FairdropSkill {
  private keyStore: EscrowKeyStore;
  // ... other properties

  constructor(config: Partial<SkillConfig> = {}) {
    // ... existing init
    this.keyStore = new FileKeyStore(config.keyStorePath);
  }

  async sell(params: { ... }): Promise<{ ... }> {
    const stamp = await this.stamps.getStamp();
    const fileData = await this.readFile(params.filePath);

    // Generate encryption key and salt
    const encryptionKey = ethers.randomBytes(32);
    const salt = ethers.randomBytes(32);

    // CRITICAL: Content hash of PLAINTEXT (buyer verifies after decryption)
    const contentHash = ethers.keccak256(fileData);

    // Application-level encryption (AES-256-GCM)
    const encryptedData = await this.encryptData(fileData, encryptionKey);

    // Upload WITHOUT Swarm-Encrypt header
    const swarmRef = await this.uploadToSwarm(encryptedData, stamp.batchId, false);

    // Key commitment for escrow (matches contract's expected format)
    const keyCommitment = ethers.keccak256(
      ethers.solidityPacked(['bytes32', 'bytes32'], [encryptionKey, salt])
    );

    // Upload metadata (unchanged)
    const metadataRef = await this.uploadToSwarm(metadataBytes, stamp.batchId, false);

    // Create escrow on-chain
    const { escrowId, txHash } = await this.escrow.createEscrow({
      contentHash,       // Hash of PLAINTEXT
      keyCommitment,     // Hash of (key || salt)
      // ... other params
    });

    // CRITICAL: Store key AFTER successful escrow creation
    await this.keyStore.save(escrowId, encryptionKey, salt, swarmRef);

    return { escrowId, txHash, swarmRef };
  }

  // Encryption helper using Web Crypto API (Node.js 15+ compatible)
  private async encryptData(data: Uint8Array, key: Uint8Array): Promise<Uint8Array> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cryptoKey = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt']);
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, data);
    // Format: [12-byte IV][ciphertext][16-byte auth tag]
    return new Uint8Array([...iv, ...new Uint8Array(encrypted)]);
  }

  // Decryption helper for buyer
  private async decryptData(encryptedData: Uint8Array, key: Uint8Array): Promise<Uint8Array> {
    const iv = encryptedData.slice(0, 12);
    const ciphertext = encryptedData.slice(12);
    const cryptoKey = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['decrypt']);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, ciphertext);
    return new Uint8Array(decrypted);
  }

  // Remove Swarm-Encrypt header for escrow uploads
  private async uploadToSwarm(data: Uint8Array, batchId: string, encrypt: boolean): Promise<string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/octet-stream',
      'Swarm-Postage-Batch-Id': batchId,
    };
    // Only use Swarm-native encryption for non-escrow uploads (e.g., publish)
    if (encrypt) {
      headers['Swarm-Encrypt'] = 'true';
    }
    // ... rest unchanged
  }
}
```

**Buyer Verification Flow**:
```typescript
// In buy() method, after receiving revealed key:
const encryptedData = await this.download(swarmRef);
const plaintext = await this.decryptData(encryptedData, revealedKey);
const verifyHash = ethers.keccak256(plaintext);
if (verifyHash !== escrow.contentHash) {
  throw new Error('Content hash mismatch - data corrupted or wrong key');
}
```

**Reference**: The `ade` CLI at `github.com/datafund/ade` has a working implementation:
- `src/crypto/escrow.ts` - AES-256-GCM encryption
- `src/escrow-keys.ts` - OS keychain storage (more secure than files)
- `src/swarm.ts` - Plain upload (no Swarm-Encrypt)

---

#### #17 - Fix Bounties Authentication Bypass (P0)

**Problem**: Multiple bounty endpoints accept unauthenticated requests:
- POST /bounties - create bounty (anyone can impersonate)
- POST /bounties/:id/fulfill - link bounty to escrow (griefing attack)
- POST /bounties/:id/cancel - cancel bounty (delete anyone's bounty)

**Files**: `packages/agents-api/src/api/routes/bounties.ts`

**Implementation**:

```typescript
import { verifySignature } from '../middleware/verify-signature.js'

export function bountyRoutes(db: AgentsDatabase): Router {
  const router = Router()

  // POST /bounties — create bounty (requires signature)
  router.post('/', verifySignature, (req, res) => {
    const verifiedAddress = (req as any).verifiedAddress as string

    // SECURITY: Always use verified signer, ignore req.body.poster
    const poster = verifiedAddress

    const { posterAgentId, title, description, category, rewardAmount, rewardToken, tags, moltbookPostId, expiresIn } = req.body
    // ... rest unchanged
  })

  // POST /bounties/:id/cancel — cancel bounty (requires signature + ownership)
  router.post('/:id/cancel', verifySignature, (req, res) => {
    const verifiedAddress = (req as any).verifiedAddress as string
    const bounty = db.getBounty(req.params.id)

    if (!bounty) {
      res.status(404).json({ error: 'Bounty not found' })
      return
    }

    // SECURITY: Only poster can cancel their own bounty
    if (bounty.poster.toLowerCase() !== verifiedAddress.toLowerCase()) {
      res.status(403).json({ error: 'Only bounty poster can cancel' })
      return
    }

    db.cancelBounty(req.params.id)
    res.json({ status: 'cancelled' })
  })

  // POST /bounties/:id/fulfill — link to escrow (requires signature)
  router.post('/:id/fulfill', verifySignature, (req, res) => {
    const verifiedAddress = (req as any).verifiedAddress as string
    const { escrowId } = req.body
    const bounty = db.getBounty(req.params.id)

    if (!bounty) {
      res.status(404).json({ error: 'Bounty not found' })
      return
    }

    // SECURITY: Only bounty poster or escrow seller can fulfill
    const escrow = db.getEscrow(Number(escrowId))
    const isPoster = bounty.poster.toLowerCase() === verifiedAddress.toLowerCase()
    const isSeller = escrow?.seller.toLowerCase() === verifiedAddress.toLowerCase()

    if (!isPoster && !isSeller) {
      res.status(403).json({ error: 'Only bounty poster or escrow seller can fulfill' })
      return
    }

    db.fulfillBounty(req.params.id, Number(escrowId))
    res.json({ status: 'fulfilled', escrowId })
  })

  // ... rest of routes
}
```

**Additional Security Measures**:

1. **Reduce signature replay window + add nonce** in `middleware/verify-signature.ts`:
```typescript
const MAX_AGE_SECONDS = 60 // Reduced from 300 to 60 seconds

// Add nonce tracking to prevent replay within the 60-second window
const usedNonces = new Map<string, number>() // nonce -> timestamp

// Clean expired nonces periodically
setInterval(() => {
  const cutoff = Date.now() - (MAX_AGE_SECONDS * 1000)
  for (const [nonce, ts] of usedNonces) {
    if (ts < cutoff) usedNonces.delete(nonce)
  }
}, 60_000)

// In verifySignature middleware:
const nonce = req.headers['x-nonce'] as string
if (!nonce || usedNonces.has(nonce)) {
  res.status(401).json({ error: 'Missing or reused nonce' })
  return
}
// After verification succeeds:
usedNonces.set(nonce, Date.now())
```

**Client-side nonce generation**:
```typescript
const nonce = crypto.randomUUID() // or ethers.hexlify(ethers.randomBytes(16))
headers['X-Nonce'] = nonce
```

2. **Add rate limiting** (new middleware):
```typescript
// packages/agents-api/src/api/middleware/rate-limit.ts
import rateLimit from 'express-rate-limit'

export const createRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Use verified address if available, else IP
    return (req as any).verifiedAddress || req.ip
  },
  message: { error: 'Too many requests, please try again later' }
})

// Apply in server.ts:
app.use('/api/v1/bounties', createRateLimit)
```

3. **Add input validation** for bounty parameters:
```typescript
// In bounties.ts POST /bounties
const { title, description, rewardAmount, rewardToken, tags, expiresIn } = req.body

// Validation
if (!title || title.length > 200) {
  return res.status(400).json({ error: 'Title required, max 200 chars' })
}
if (description && description.length > 5000) {
  return res.status(400).json({ error: 'Description max 5000 chars' })
}
if (!rewardAmount || BigInt(rewardAmount) < 0n) {
  return res.status(400).json({ error: 'Valid reward amount required' })
}
if (tags && (!Array.isArray(tags) || tags.length > 10)) {
  return res.status(400).json({ error: 'Max 10 tags allowed' })
}
if (expiresIn && (expiresIn < 86400 || expiresIn > 365 * 86400)) {
  return res.status(400).json({ error: 'Expiry must be 1-365 days' })
}
```

---

#### #9 + #11 - Fix Skills/Escrow Linking & Status (P1)

**Problem**:
- Skills return `sold_out` when never listed
- Escrows not properly linked to skills

**Files**:
- `packages/agents-api/src/api/routes/skills.ts`
- `packages/agents-api/src/db/database.ts`

**Implementation for #11** (in skills.ts):

```typescript
// In GET /skills/:id/purchase-info

// No available escrows — determine correct status
const allEscrows = db.listEscrowsForSkill(req.params.id)

let status: string
let note: string

if (allEscrows.length === 0 && skill.total_sales === 0) {
  // Never had any escrows
  status = 'not_listed'
  note = 'Seller has not created an escrow yet. Contact seller or create a bounty.'
} else if (allEscrows.length === 0 && skill.total_sales > 0) {
  // Had escrows, all sold
  status = 'sold_out'
  note = 'All copies sold. Check back later or contact seller.'
} else {
  // Has escrows but none available (all funded/in-progress)
  status = 'in_progress'
  note = 'All escrows currently in progress. Check back later.'
}

res.json({
  status,
  seller: skill.seller,
  content_hash: skill.content_hash,
  encrypted_data_ref: skill.encrypted_data_ref || '',
  total_sales: skill.total_sales,
  note,
})
```

**Implementation for #9** - Improve skill→escrow linking:

```typescript
// In database.ts - add method to auto-link by content_hash
linkEscrowToSkillByContentHash(escrowId: number, contentHash: string): boolean {
  const skill = this.db.prepare(
    'SELECT id FROM skills WHERE content_hash = ? LIMIT 1'
  ).get(contentHash) as { id: string } | undefined

  if (skill) {
    this.db.prepare('UPDATE escrows SET skill_id = ? WHERE id = ?').run(skill.id, escrowId)
    this.db.prepare('UPDATE skills SET escrow_id = ? WHERE id = ?').run(escrowId, skill.id)
    return true
  }
  return false
}

// Call this in the escrow event handler when EscrowCreated event is processed
```

---

### Phase 2: UX Improvements (P1-P2)

#### #12 - Add Availability Indicator to Skill Cards

**Files**:
- `packages/agents-api/src/db/database.ts` (batch query)
- `packages/agents-api/src/api/routes/skills.ts` (add availability)
- `packages/agents-api/public/skills.html` (UI badges)

**Backend - Add batch query to avoid N+1 problem**:

```typescript
// In database.ts - add method for batch availability check
getAvailabilityForSkills(skillIds: string[]): Map<string, { available: number; totalSales: number }> {
  if (skillIds.length === 0) return new Map();

  const placeholders = skillIds.map(() => '?').join(',');
  const rows = this.db.prepare(`
    SELECT
      s.id as skill_id,
      s.total_sales,
      COUNT(CASE WHEN e.state = 'created' THEN 1 END) as available_count
    FROM skills s
    LEFT JOIN escrows e ON e.skill_id = s.id AND e.state = 'created'
    WHERE s.id IN (${placeholders})
    GROUP BY s.id
  `).all(...skillIds) as Array<{ skill_id: string; total_sales: number; available_count: number }>;

  const result = new Map();
  for (const row of rows) {
    result.set(row.skill_id, { available: row.available_count, totalSales: row.total_sales });
  }
  return result;
}
```

**Update skills.ts GET /skills**:

```typescript
router.get('/', (req, res) => {
  const skills = db.listSkills({ ... });
  const skillIds = skills.map(s => s.id);
  const availabilityMap = db.getAvailabilityForSkills(skillIds);

  const enrichedSkills = skills.map(skill => {
    const avail = availabilityMap.get(skill.id) || { available: 0, totalSales: 0 };
    let availability: string;
    if (avail.available > 0) {
      availability = 'purchasable';
    } else if (avail.totalSales > 0) {
      availability = 'sold_out';
    } else {
      availability = 'not_listed';
    }
    return { ...skill, tags: JSON.parse(skill.tags), availability };
  });

  res.json({ skills: enrichedSkills, total });
});
```

**Frontend - Add CSS and badge rendering in skills.html**:

```css
.status-badge {
  position: absolute;
  top: 12px;
  right: 12px;
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 600;
  text-transform: uppercase;
}
.status-badge.available { background: #dcfce7; color: #16a34a; }
.status-badge.pending { background: #fef3c7; color: #ca8a04; }
.status-badge.sold-out { background: #fee2e2; color: #dc2626; }
```

```javascript
function renderSkillCard(s) {
  const statusBadge = s.availability === 'purchasable'
    ? '<span class="status-badge available">Available</span>'
    : s.availability === 'not_listed'
    ? '<span class="status-badge pending">Coming Soon</span>'
    : '<span class="status-badge sold-out">Sold Out</span>';

  return `<div class="skill-card" style="position:relative">
    ${statusBadge}
    ...
  </div>`;
}
```

---

#### #16 - Fix URL Inconsistency (/skill vs /skills)

**Clarification**: The issue is about REST API consistency, not HTML routes.
- HTML: `/skill/:id` → serves `skill.html` (keep as-is for SEO)
- API: `/api/v1/skill/:id` should redirect to `/api/v1/skills/:id`

**Files**: `packages/agents-api/src/api/server.ts`

**Implementation**:

```typescript
// Add API redirect from singular to plural (backwards compatibility)
app.get('/api/v1/skill/:id', (req, res) => {
  res.redirect(301, `/api/v1/skills/${req.params.id}`)
})

app.get('/api/v1/skill/:id/purchase-info', (req, res) => {
  res.redirect(301, `/api/v1/skills/${req.params.id}/purchase-info`)
})

// Keep HTML route as-is (already works at /skill/:id)
```

---

#### #15 - Add Documentation Page

**Files**:
- Create `packages/agents-api/public/docs.html`
- Update navigation in other HTML files

**Implementation**: Create docs.html that renders README.md content or embeds key sections:
- API reference table
- Purchase flow diagram
- CLI command reference
- Getting started guides

---

#### #24 - Fix CLI Registry Redirect (P1 - Quick Win)

**Files**: CLI package (likely in molthub or similar)

**Implementation**:

```typescript
// When making HTTP requests, follow redirects
const response = await fetch(url, {
  redirect: 'follow',  // Ensure redirects are followed
  // ... other options
});

// Or default to www subdomain
const REGISTRY_URL = process.env.REGISTRY_URL || 'https://www.clawhub.ai';
```

---

#### #30 - Add Confirmation/Dry-run to CLI Publish

**Files**: CLI publish command

**Implementation**:

```typescript
// Add flags
interface PublishOptions {
  dryRun?: boolean;
  yes?: boolean;  // Skip confirmation
}

async function publish(skillPath: string, options: PublishOptions) {
  const skill = await loadSkill(skillPath);

  // Show preview
  console.log('Publishing:', skill.name, '@', skill.version);
  console.log('  Files:', skill.files.map(f => f.name).join(', '));
  console.log('  Tags:', skill.tags.join(', '));

  if (options.dryRun) {
    console.log('\n[Dry run] Would publish to registry. No changes made.');
    return;
  }

  if (!options.yes) {
    const confirm = await prompt('Proceed? [y/N]');
    if (confirm.toLowerCase() !== 'y') {
      console.log('Cancelled.');
      return;
    }
  }

  // Actually publish
  await doPublish(skill);
}
```

---

### Phase 3: Infrastructure & Low Priority

#### #22 - Add Retry Logic for fairdrop.xyz

**Files**: `packages/skill/src/stamps.ts`

**Implementation** - Add retry to `requestSharedStamp()` method:

```typescript
export class Stamps {
  // ... existing properties

  // Add sleep helper
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Update requestSharedStamp with retry logic
  private async requestSharedStamp(retries = 3): Promise<StampInfo> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const response = await fetch(`${this.fairdropApi}/api/free-stamp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            timestamp: Date.now(),
            accountId: this.accountId,
          }),
          signal: AbortSignal.timeout(10000),
        });

        if (response.ok) {
          return await response.json();
        }

        // Transient errors - retry with exponential backoff
        if (response.status === 502 || response.status === 503 || response.status === 504) {
          lastError = new Error(`Stamp API returned ${response.status}`);
          await this.sleep(Math.pow(2, attempt) * 1000); // 1s, 2s, 4s
          continue;
        }

        // Non-transient error - don't retry
        throw new Error(`Stamp API error: ${response.status} ${response.statusText}`);
      } catch (e) {
        lastError = e as Error;
        if (attempt < retries - 1) {
          await this.sleep(Math.pow(2, attempt) * 1000);
        }
      }
    }

    throw new Error(`Stamp API unavailable after ${retries} attempts: ${lastError?.message}`);
  }

  // getStamp() method remains unchanged - it uses requestSharedStamp internally
}
```

**Server-side action item** (for infra team):
- Set up monitoring/alerting for 502 errors on fairdrop.xyz
- Add health check endpoint: `GET /api/health`
- Consider CDN/redundancy for stamp endpoint

---

#### #18 - Handle Duplicate Skills

**Decision**: **Allow duplicates** with seller differentiation.

Rationale: Multiple sellers offering similar skills creates healthy competition. Uniqueness would prevent legitimate use cases (e.g., two developers selling GTD processors with different approaches).

**Implementation**:

1. **UI differentiation** - Show seller on cards:
```javascript
// In skills.html card template
<div class="skill-seller">by ${walletName(s.seller)}</div>
```

2. **Add CSS**:
```css
.skill-seller {
  font-size: 12px;
  color: var(--text-dim);
  margin-top: 8px;
}
.skill-seller a { color: var(--accent); }
```

3. **Optional: Add seller reputation badge**:
```javascript
const repBadge = s.seller_reputation?.tier === 'trusted'
  ? '<span class="rep-badge">✓ Trusted</span>'
  : '';
```

---

#### #13 - MCP Server Investigation

**Action**: Infrastructure team needs to investigate `mcp.id.fairdatasociety.org`
- Check if service is running
- Verify DNS resolution
- Check firewall/network config
- If deprecated, update README

---

#### #21 - Price Display (Already Fixed)

**Status**: Code is fixed - `formatPrice()` in `wallets.js` properly converts wei to ETH.

**Action**: Ensure production deployment includes latest `wallets.js`.

---

#### #23 - REST API for Escrows (Already Resolved)

**Status**: PR #38 added the endpoint. Can close this issue.

---

#### #14 - Publish to Registry (Deferred)

**Status**: Will publish at product launch per user request.

---

## Implementation Order

### Week 1 - Critical Security & Debugging Foundation

| Order | Issue | Est. Hours | Dependency |
|-------|-------|------------|------------|
| 1.1 | #27 - Contract revert reasons | 2h | None (enables debugging all else) |
| 1.2 | #17 - Bounties auth bypass | 4h | None |
| 1.3 | #39 - Encryption key handling | 8h | #27 (for debugging) |
| 1.4 | #24 - CLI redirect fix | 0.5h | None (quick win) |

### Week 2 - Data Integrity & Status

| Order | Issue | Est. Hours | Dependency |
|-------|-------|------------|------------|
| 2.1 | #11 - Fix misleading status | 2h | None |
| 2.2 | #9 - Skill→escrow linking | 4h | #11 |
| 2.3 | #12 - Availability indicator | 3h | #9, #11 |
| 2.4 | #16 - API URL consistency | 1h | None |

### Week 3 - UX & Documentation

| Order | Issue | Est. Hours | Dependency |
|-------|-------|------------|------------|
| 3.1 | #22 - Retry logic for stamps | 2h | None |
| 3.2 | #15 - Documentation page | 4h | None |
| 3.3 | #30 - Publish confirmation | 2h | None |
| 3.4 | #18 - Duplicate handling | 1h | Decision: allow with seller differentiation |

### Parallel/Ongoing

| Issue | Owner | Status |
|-------|-------|--------|
| #13 - MCP server | Infra team | Blocked - needs server access |
| #21 - Price display | Deploy | Fixed in code - verify production |
| #23 - REST API | - | Close as resolved (PR #38) |
| #14 - Registry publish | - | Deferred to launch |

---

## Testing Strategy

**Test Framework**: Vitest (already configured in `packages/agents-api/vitest.config.ts`)

**CI/CD**: All PRs must pass tests before merge. GitHub Actions runs:
```yaml
# .github/workflows/test.yml
- npm ci
- npm run lint
- npm run test
- npm run build
```

### Unit Tests (per issue)

**#39 - Encryption**:
```typescript
// packages/skill/test/encryption.test.ts
test('sell() encrypts with AES-GCM and stores key', async () => {
  const skill = new FairdropSkill({ keyStorePath: tempDir });
  const result = await skill.sell({ filePath: testFile, ... });

  // Verify key was stored
  const keyData = await skill.keyStore.get(result.escrowId);
  expect(keyData).not.toBeNull();
  expect(keyData.key).toHaveLength(64); // 32 bytes hex

  // Verify encrypted data can be decrypted
  const encrypted = await fetch(`${BEE_URL}/bytes/${result.swarmRef}`);
  const decrypted = await skill.decryptData(encrypted, Buffer.from(keyData.key, 'hex'));
  expect(ethers.keccak256(decrypted)).toBe(contentHash);
});

test('buy() verifies content hash after decryption', async () => {
  // ... test buyer flow with hash verification
});
```

**#17 - Auth**:
```typescript
// packages/agents-api/test/bounties.test.ts
test('POST /bounties without signature returns 401', async () => {
  const res = await fetch('/api/v1/bounties', {
    method: 'POST',
    body: JSON.stringify({ title: 'Test', rewardAmount: '1000' }),
  });
  expect(res.status).toBe(401);
});

test('POST /bounties/:id/cancel by non-owner returns 403', async () => {
  // Create bounty as Alice, try to cancel as Bob
  const bounty = await createBountyAs(alice);
  const res = await cancelBountyAs(bob, bounty.id);
  expect(res.status).toBe(403);
});
```

### Integration Tests

```bash
# Run after each phase completion
npm run test:integration

# Manual verification checklist
curl -X POST /api/v1/bounties -d '...' # Should return 401
curl /api/v1/skills/xxx/purchase-info  # Should return not_listed, not sold_out
```

### Deployment Verification

After each deployment:
1. Verify `/api/v1/health` returns OK
2. Test bounty creation requires signature
3. Test skill purchase-info returns correct status
4. Verify `formatPrice()` displays ETH correctly

### Rollback Strategy

If verification fails after deployment:

1. **Immediate rollback**:
```bash
# Revert to previous Docker image tag
docker pull ghcr.io/datafund/agents-api:previous
docker-compose up -d

# Or git revert
git revert HEAD
git push origin main
# Trigger CI/CD redeploy
```

2. **Database migrations**: All schema changes use `ALTER TABLE ... ADD COLUMN` which are backwards-compatible. No rollback needed for DB.

3. **Contract changes**: Smart contracts are immutable. If #27 introduces bugs, deploy new contract version and update `ADDRESSES.base.escrowAddress`.

4. **Communication**: If user-facing issues occur, post status update to GitHub and notify via appropriate channels.

---

## Verification Checklist

After implementation, verify:

- [ ] `sell()` encrypts with stored key, not Swarm-native
- [ ] `sell()` stores key securely for later reveal
- [ ] `buy()` can decrypt data with revealed key
- [ ] POST /bounties requires valid signature
- [ ] Skills show correct status (not_listed vs sold_out)
- [ ] Skill cards show availability badges
- [ ] /skill/:id redirects to /skills/:id
- [ ] /docs page accessible and helpful
- [ ] Contract reverts include messages
- [ ] Stamp API has retry logic
- [ ] CLI publish has --dry-run and confirmation
