/**
 * Fairdrop OpenClaw Skill
 *
 * Commands:
 *   send <file> <recipient>     — Encrypted file transfer
 *   publish <file>              — Upload to Swarm, get public link
 *   download <ref>              — Download from Swarm reference
 *   sell <file> <price> <token> — Create escrow offering
 *   buy <escrowId>              — Fund escrow, get data
 *   search <query>              — Multi-channel discovery
 *   bounty <title> <reward>     — Post data requirement
 *   identity                    — Register/show ERC-8004 identity
 *   status                      — Wallet, stamps, escrows overview
 *
 * All financial operations require confirmation unless below autoApproveBelow.
 */

import { webcrypto as crypto } from 'crypto';
import { ethers, JsonRpcProvider } from 'ethers';
import { DataEscrow, ERC8004, ADDRESSES, EscrowState } from '@ade/contracts';
import { Discovery, type SearchResult, type SanitizedOffering } from '@fairdrop/discovery';
import { Wallet } from './wallet.js';
import { Stamps, type StampInfo } from './stamps.js';
import { DEFAULT_CONFIG, type SkillConfig } from './config.js';
import { FileKeyStore, type EscrowKeyStore, type EscrowKeyData } from './key-store.js';

export class FairdropSkill {
  private config: SkillConfig;
  private wallet: Wallet;
  private stamps: Stamps;
  private escrow: DataEscrow;
  private erc8004: ERC8004;
  private discovery: Discovery;
  private keyStore: EscrowKeyStore;

  constructor(config: Partial<SkillConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.wallet = new Wallet(this.config.keystorePath);
    this.stamps = new Stamps(this.config.fairdropApi);
    this.escrow = new DataEscrow({
      rpcUrl: this.config.baseRpcUrl,
      privateKey: process.env.PRIVATE_KEY,
    });
    this.erc8004 = new ERC8004(
      new JsonRpcProvider(ADDRESSES.erc8004.rpcUrl),
    );
    this.discovery = new Discovery({
      escrow: this.escrow,
      beeUrl: this.config.beeUrl,
      moltbookApiKey: this.config.moltbookApiKey,
    });
    this.keyStore = new FileKeyStore((this.config as any).keyStorePath);
  }

  // ============ Setup ============

  /**
   * First-run setup. Generates wallet, gets stamp.
   */
  async setup(password: string): Promise<{
    address: string;
    stamp: StampInfo;
  }> {
    let address: string;

    if (this.wallet.exists) {
      address = await this.wallet.unlock(password);
    } else {
      address = await this.wallet.generate(password);
    }

    const stamp = await this.stamps.getStamp();

    return { address, stamp };
  }

  // ============ File Operations ============

  /**
   * Send encrypted file to a recipient.
   */
  async send(filePath: string, recipientAddress: string): Promise<{
    swarmRef: string;
    recipient: string;
  }> {
    const stamp = await this.stamps.getStamp();

    // Upload encrypted to Swarm via Bee API (Swarm-native encryption OK for send)
    const fileData = await this.readFile(filePath);
    const encryptedRef = await this.uploadToSwarm(fileData, stamp.batchId, true);

    return {
      swarmRef: encryptedRef,
      recipient: recipientAddress,
    };
  }

  /**
   * Upload file to Swarm and get a public link.
   */
  async publish(filePath: string): Promise<{
    swarmRef: string;
    publicUrl: string;
  }> {
    const stamp = await this.stamps.getStamp();
    const fileData = await this.readFile(filePath);
    const ref = await this.uploadToSwarm(fileData, stamp.batchId, false);

    return {
      swarmRef: ref,
      publicUrl: `https://gateway.fairdrop.xyz/bzz/${ref}`,
    };
  }

  /**
   * Download file from Swarm reference.
   */
  async download(swarmRef: string): Promise<Uint8Array> {
    const response = await fetch(
      `${this.config.beeUrl}/bzz/${swarmRef}`,
      { signal: AbortSignal.timeout(30000) },
    );
    if (!response.ok) throw new Error(`Download failed: ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }

  // ============ Data Commerce ============

  /**
   * Sell data via escrow.
   * Creates escrow on-chain + uploads encrypted data to Swarm + announces on Moltbook.
   *
   * SECURITY: Uses application-level AES-256-GCM encryption (NOT Swarm-native).
   * The encryption key is stored securely for later reveal to buyer.
   */
  async sell(params: {
    filePath: string;
    title: string;
    description: string;
    price: string;
    paymentToken?: string;
    category: string;
    tags?: string[];
    fastSettle?: boolean;
    designatedBuyer?: string;
  }): Promise<{
    escrowId: string;
    txHash: string;
    swarmRef: string;
    contentHash: string;
    moltbookPostId?: string;
  }> {
    const stamp = await this.stamps.getStamp();

    // 1. Read file and generate encryption materials
    const fileData = await this.readFile(params.filePath);
    const encryptionKey = ethers.randomBytes(32);
    const salt = ethers.randomBytes(32);

    // 2. CRITICAL: Content hash of PLAINTEXT (buyer verifies after decryption)
    const contentHash = ethers.keccak256(fileData);

    // 3. Application-level encryption (AES-256-GCM)
    const encryptedData = await this.encryptData(fileData, encryptionKey);

    // 4. Upload encrypted data WITHOUT Swarm-Encrypt header
    const swarmRef = await this.uploadToSwarm(encryptedData, stamp.batchId, false);

    // 5. Upload metadata (not encrypted)
    const metadata = {
      title: params.title,
      description: params.description,
      tags: params.tags || [],
      category: params.category,
      contentSize: fileData.length,
      created: new Date().toISOString(),
    };
    const metadataBytes = new TextEncoder().encode(JSON.stringify(metadata));
    const metadataRef = await this.uploadToSwarm(metadataBytes, stamp.batchId, false);

    // 6. Key commitment (matches contract's expected format with salt)
    const keyCommitment = ethers.keccak256(
      ethers.solidityPacked(['bytes32', 'bytes32'], [encryptionKey, salt])
    );

    // 7. Create escrow on-chain
    const priceWei = ethers.parseEther(params.price);
    const { escrowId, txHash } = await this.escrow.createEscrow({
      contentHash,       // Hash of PLAINTEXT for buyer verification
      keyCommitment,     // Hash of (key || salt)
      amount: priceWei,
      metadataHash: `0x${metadataRef}`,
      category: ethers.id(params.category),
      expectedDataHash: contentHash,
      designatedBuyer: params.designatedBuyer,
      fastSettle: params.fastSettle,
    });

    // 8. CRITICAL: Store key securely for later reveal
    await this.keyStore.save(escrowId, encryptionKey, salt, swarmRef, contentHash);

    // 9. Announce on Moltbook (non-blocking)
    const moltbookResult = await this.discovery.announce({
      escrowId,
      seller: this.wallet.address,
      title: params.title,
      description: params.description,
      category: params.category,
      priceFormatted: params.price,
      paymentToken: params.paymentToken || 'ETH',
      tags: params.tags || [],
      contentHash,
      fastSettle: params.fastSettle || false,
      expiresAt: Math.floor(Date.now() / 1000) + 7 * 86400,
    });

    return {
      escrowId,
      txHash,
      swarmRef,
      contentHash,
      moltbookPostId: moltbookResult?.postId,
    };
  }

  /**
   * Get stored key data for an escrow (seller use for reveal).
   */
  async getStoredKey(escrowId: string): Promise<EscrowKeyData | null> {
    return this.keyStore.get(escrowId);
  }

  /**
   * List all stored escrow keys.
   */
  async listStoredKeys(): Promise<string[]> {
    return this.keyStore.list();
  }

  /**
   * Buy data via escrow.
   * Funds the escrow, waits for key release, decrypts.
   */
  async buy(escrowId: string): Promise<{
    txHash: string;
    state: string;
    message: string;
  }> {
    // 1. Get escrow details
    const details = await this.escrow.getEscrow(escrowId);

    if (details.state !== EscrowState.Created) {
      throw new Error(`Escrow is in state ${EscrowState[details.state]}, expected Created`);
    }

    // 2. Check if designated buyer
    if (details.designatedBuyer !== ethers.ZeroAddress &&
        details.designatedBuyer !== this.wallet.address) {
      throw new Error('This escrow is reserved for a specific buyer');
    }

    // 3. Fund escrow
    const isERC20 = details.paymentToken !== ethers.ZeroAddress;
    const txHash = await this.escrow.fundEscrow(escrowId, details.amount, isERC20);

    return {
      txHash,
      state: 'funded',
      message: 'Escrow funded. Waiting for seller to release key. You will be able to decrypt once the key is revealed.',
    };
  }

  /**
   * Decrypt purchased data with revealed key.
   * Verifies content hash matches expected hash from escrow.
   */
  async decryptPurchasedData(
    swarmRef: string,
    revealedKey: Uint8Array,
    expectedContentHash: string,
  ): Promise<Uint8Array> {
    // 1. Download encrypted data from Swarm
    const encryptedData = await this.download(swarmRef);

    // 2. Decrypt
    const plaintext = await this.decryptData(encryptedData, revealedKey);

    // 3. Verify content hash
    const actualHash = ethers.keccak256(plaintext);
    if (actualHash !== expectedContentHash) {
      throw new Error(
        `Content hash mismatch! Expected ${expectedContentHash}, got ${actualHash}. ` +
        'Data may be corrupted or wrong key was used.'
      );
    }

    return plaintext;
  }

  // ============ Discovery ============

  /**
   * Search for data across all channels.
   */
  async search(query: string, options?: {
    category?: string;
    minReputation?: number;
    fastSettleOnly?: boolean;
  }): Promise<SearchResult> {
    return this.discovery.search({
      query,
      category: options?.category,
      minReputation: options?.minReputation,
      fastSettleOnly: options?.fastSettleOnly,
    });
  }

  /**
   * Post a bounty / data requirement.
   */
  async bounty(params: {
    title: string;
    description: string;
    reward: string;
    paymentToken?: string;
    category: string;
    tags?: string[];
    expiryDays?: number;
  }): Promise<{ postId?: string }> {
    const result = await this.discovery.postBounty({
      title: params.title,
      description: params.description,
      category: params.category,
      rewardFormatted: params.reward,
      paymentToken: params.paymentToken || 'USDC',
      tags: params.tags || [],
      buyer: this.wallet.address,
      expiresAt: Math.floor(Date.now() / 1000) + (params.expiryDays || 7) * 86400,
    });

    return { postId: result?.postId };
  }

  // ============ Identity ============

  /**
   * Register on-chain agent identity via ERC-8004.
   * Deferred until explicitly called (not required for basic use).
   */
  async registerIdentity(profile: {
    name: string;
    description: string;
    capabilities: string[];
  }): Promise<{ agentId: string; txHash: string }> {
    const provider = new JsonRpcProvider(ADDRESSES.erc8004.rpcUrl);
    const signer = this.wallet.connect(provider);

    const result = await this.erc8004.register(signer, {
      name: profile.name,
      description: profile.description,
      capabilities: profile.capabilities,
    });

    this.config.agentId = result.agentId;
    return result;
  }

  /**
   * Get reputation summary.
   */
  async reputation(agentId?: string): Promise<{
    agentId: string;
    score: number;
    feedbackCount: number;
    deliveries: number;
  }> {
    const id = agentId || this.config.agentId;
    if (!id) throw new Error('No agent ID. Run identity registration first.');

    const rep = await this.erc8004.getReputation(id);
    return {
      agentId: id,
      score: rep.averageScore,
      feedbackCount: rep.count,
      deliveries: rep.successfulDeliveries,
    };
  }

  // ============ Status ============

  /**
   * Overview of wallet, stamps, and active escrows.
   */
  async status(): Promise<{
    wallet: { address: string; unlocked: boolean };
    stamp: StampInfo | null;
    agentId: string | null;
    storedKeys: number;
    version: string;
  }> {
    let stamp: StampInfo | null = null;
    try {
      stamp = await this.stamps.getStamp();
    } catch {
      // No stamp available
    }

    const storedKeys = (await this.keyStore.list()).length;

    return {
      wallet: {
        address: this.wallet.address,
        unlocked: this.wallet.isUnlocked,
      },
      stamp,
      agentId: this.config.agentId || null,
      storedKeys,
      version: '0.2.0',
    };
  }

  // ============ Encryption Helpers ============

  /**
   * Encrypt data using AES-256-GCM.
   * Output format: [12-byte IV][ciphertext with auth tag]
   */
  private async encryptData(data: Uint8Array, key: Uint8Array): Promise<Uint8Array> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'AES-GCM' },
      false,
      ['encrypt']
    );
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      data
    );
    // Prepend IV to ciphertext (includes auth tag)
    return new Uint8Array([...iv, ...new Uint8Array(encrypted)]);
  }

  /**
   * Decrypt data using AES-256-GCM.
   * Input format: [12-byte IV][ciphertext with auth tag]
   */
  private async decryptData(encryptedData: Uint8Array, key: Uint8Array): Promise<Uint8Array> {
    const iv = encryptedData.slice(0, 12);
    const ciphertext = encryptedData.slice(12);
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      ciphertext
    );
    return new Uint8Array(decrypted);
  }

  // ============ Internal Helpers ============

  private async readFile(filePath: string): Promise<Uint8Array> {
    const fs = await import('fs');
    return new Uint8Array(fs.readFileSync(filePath));
  }

  private async uploadToSwarm(
    data: Uint8Array,
    batchId: string,
    encrypt: boolean,
  ): Promise<string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/octet-stream',
      'Swarm-Postage-Batch-Id': batchId,
    };
    // Only use Swarm-native encryption for non-escrow operations (send, etc.)
    // For escrow, we use application-level encryption to control key reveal
    if (encrypt) {
      headers['Swarm-Encrypt'] = 'true';
    }

    const response = await fetch(`${this.config.beeUrl}/bytes`, {
      method: 'POST',
      headers,
      body: data,
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      throw new Error(`Swarm upload failed: ${response.status}`);
    }

    const result = await response.json() as { reference: string };
    return result.reference;
  }
}
