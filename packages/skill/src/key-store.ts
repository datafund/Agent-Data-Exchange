/**
 * Escrow key storage with atomic writes and restricted permissions.
 *
 * Keys are stored in ~/.fairdrop/escrow-keys/ with mode 0600.
 *
 * SECURITY NOTE: Keys are stored unencrypted. File permissions (0600) provide
 * OS-level protection. For higher security, consider:
 * - OS keychain integration (see ade CLI's escrow-keys.ts)
 * - Password-derived encryption key
 * - Hardware security module (HSM) for production
 */

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
  key: string;      // hex-encoded (32 bytes = 64 chars)
  salt: string;     // hex-encoded (32 bytes = 64 chars)
  swarmRef: string; // Swarm reference for encrypted data
  contentHash: string; // Hash of plaintext for buyer verification
  createdAt: number;
}

export interface EscrowKeyStore {
  save(escrowId: string, key: Uint8Array, salt: Uint8Array, swarmRef: string, contentHash: string): Promise<void>;
  get(escrowId: string): Promise<EscrowKeyData | null>;
  delete(escrowId: string): Promise<void>;
  list(): Promise<string[]>;
}

/**
 * File-based key storage with atomic writes and restricted permissions.
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

  /**
   * Clean up orphan .tmp files older than 5 minutes.
   * These can occur if process crashes during atomic write.
   */
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
    } catch {
      // Ignore cleanup errors - not critical
    }
  }

  async save(
    escrowId: string,
    key: Uint8Array,
    salt: Uint8Array,
    swarmRef: string,
    contentHash: string,
  ): Promise<void> {
    // Validate key and salt are exactly 32 bytes
    if (key.length !== 32 || salt.length !== 32) {
      throw new Error('Key and salt must be exactly 32 bytes');
    }

    const data: EscrowKeyData = {
      key: Buffer.from(key).toString('hex'),
      salt: Buffer.from(salt).toString('hex'),
      swarmRef,
      contentHash,
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
    try {
      const path = this.keyPath(escrowId);
      if (!existsSync(path)) return null;
      const content = readFileSync(path, 'utf-8');
      return JSON.parse(content) as EscrowKeyData;
    } catch {
      return null;
    }
  }

  async delete(escrowId: string): Promise<void> {
    try {
      const path = this.keyPath(escrowId);
      if (existsSync(path)) {
        unlinkSync(path);
      }
    } catch (e) {
      console.warn(`Failed to delete key file for escrow ${escrowId}:`, e);
    }
  }

  async list(): Promise<string[]> {
    try {
      const files = readdirSync(this.baseDir);
      return files
        .filter(f => f.endsWith('.json') && !f.endsWith('.tmp'))
        .map(f => f.replace('.json', ''));
    } catch {
      return [];
    }
  }
}
