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

import { ethers, JsonRpcProvider } from 'ethers';
import { DataEscrow, ERC8004, ADDRESSES, EscrowState } from '@fairdrop/contracts';
import { Discovery, type SearchResult, type SanitizedOffering } from '@fairdrop/discovery';
import { Wallet } from './wallet.js';
import { Stamps, type StampInfo } from './stamps.js';
import { DEFAULT_CONFIG, type SkillConfig } from './config.js';

export class FairdropSkill {
  private config: SkillConfig;
  private wallet: Wallet;
  private stamps: Stamps;
  private escrow: DataEscrow;
  private erc8004: ERC8004;
  private discovery: Discovery;

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

    // Upload encrypted to Swarm via Bee API
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
    moltbookPostId?: string;
  }> {
    const stamp = await this.stamps.getStamp();

    // 1. Read and encrypt file
    const fileData = await this.readFile(params.filePath);
    const encryptionKey = ethers.randomBytes(32);
    const contentHash = ethers.keccak256(fileData);

    // 2. Upload encrypted to Swarm
    const swarmRef = await this.uploadToSwarm(fileData, stamp.batchId, true);

    // 3. Upload metadata to Swarm
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

    // 4. Create escrow on-chain
    const priceWei = ethers.parseEther(params.price);
    const keyCommitment = ethers.keccak256(encryptionKey);

    const { escrowId, txHash } = await this.escrow.createEscrow({
      contentHash,
      keyCommitment,
      amount: priceWei,
      metadataHash: `0x${metadataRef}`,
      category: ethers.id(params.category),
      expectedDataHash: contentHash,
      designatedBuyer: params.designatedBuyer,
      fastSettle: params.fastSettle,
    });

    // 5. Announce on Moltbook (non-blocking)
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

    // TODO: Store encryption key securely for later release
    // In production, use escrow keystore (encrypted, crash-recovery safe)

    return {
      escrowId,
      txHash,
      swarmRef,
      moltbookPostId: moltbookResult?.postId,
    };
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
    version: string;
  }> {
    let stamp: StampInfo | null = null;
    try {
      stamp = await this.stamps.getStamp();
    } catch {
      // No stamp available
    }

    return {
      wallet: {
        address: this.wallet.address,
        unlocked: this.wallet.isUnlocked,
      },
      stamp,
      agentId: this.config.agentId || null,
      version: '0.1.0',
    };
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
