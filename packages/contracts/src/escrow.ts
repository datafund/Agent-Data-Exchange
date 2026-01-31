/**
 * DataEscrow contract interface.
 *
 * Updated ABI reflecting evaluation mitigations:
 * - designatedBuyer: prevents front-running
 * - expectedDataHash: verify-then-pay for fast settlement
 * - metadataHash (bytes32): cheap on-chain discovery
 * - category (bytes32 indexed): efficient event filtering
 * - platformFeeBps: owner-configurable revenue (set to 0 at launch)
 * - fastSettle: opt-in instant settlement (no dispute window)
 */

import { ethers, Contract, Wallet, JsonRpcProvider, type TransactionReceipt } from 'ethers';
import { ADDRESSES, TOKENS, type NetworkConfig } from './addresses.js';

// Escrow states matching contract enum
export enum EscrowState {
  Created = 0,
  Funded = 1,
  KeyCommitted = 2,
  Released = 3,
  Claimed = 4,
  Expired = 5,
  Cancelled = 6,
  Disputed = 7,
  SellerResponded = 8,
  ResolvedBuyer = 9,
  ResolvedSeller = 10,
}

export interface EscrowDetails {
  escrowId: string;
  seller: string;
  buyer: string;
  paymentToken: string;
  contentHash: string;
  keyCommitment: string;
  expectedDataHash: string;
  metadataHash: string;
  category: string;
  amount: bigint;
  expiresAt: number;
  state: EscrowState;
  fastSettle: boolean;
  designatedBuyer: string;
}

export interface EscrowConfig {
  rpcUrl?: string;
  contractAddress?: string;
  privateKey?: string;
}

// Full ABI for the updated DataEscrow contract
const DATA_ESCROW_ABI = [
  // Core functions (updated with new parameters)
  `function createEscrow(
    bytes32 contentHash,
    bytes32 keyCommitment,
    address paymentToken,
    uint256 amount,
    uint256 expiryDays,
    bytes32 metadataHash,
    bytes32 category,
    bytes32 expectedDataHash,
    address designatedBuyer,
    bool fastSettle
  ) external returns (uint256)`,

  'function fundEscrow(uint256 escrowId) external payable',
  'function fundEscrowWithToken(uint256 escrowId) external',
  'function commitKeyRelease(uint256 escrowId, bytes32 encryptedKeyCommitment) external',
  'function revealKey(uint256 escrowId, bytes calldata encryptedKeyForBuyer, bytes32 salt) external',
  'function claimPayment(uint256 escrowId) external',
  'function claimExpired(uint256 escrowId) external',

  // Dispute functions
  'function disputeEscrow(uint256 escrowId) external payable',
  'function respondToDispute(uint256 escrowId, string calldata response) external',
  'function claimDisputeTimeout(uint256 escrowId) external',

  // View functions
  `function getEscrow(uint256 escrowId) external view returns (
    address seller,
    address buyer,
    address paymentToken,
    bytes32 contentHash,
    bytes32 keyCommitment,
    uint256 amount,
    uint256 expiresAt,
    uint8 state
  )`,

  // Events (updated with new fields)
  `event EscrowCreated(
    uint256 indexed escrowId,
    address indexed seller,
    bytes32 indexed category,
    address paymentToken,
    bytes32 contentHash,
    bytes32 keyCommitment,
    bytes32 metadataHash,
    bytes32 expectedDataHash,
    uint256 amount,
    uint256 expiresAt,
    bool fastSettle
  )`,
  'event EscrowFunded(uint256 indexed escrowId, address indexed buyer, uint256 amount)',
  'event KeyCommitted(uint256 indexed escrowId, bytes32 encryptedKeyCommitment, uint256 commitBlock, uint256 commitTimestamp)',
  'event KeyRevealed(uint256 indexed escrowId, bytes encryptedKeyForBuyer)',
  'event PaymentClaimed(uint256 indexed escrowId, address indexed seller, uint256 amount)',
  'event EscrowExpired(uint256 indexed escrowId, address indexed buyer, uint256 amount)',
  'event DisputeRaised(uint256 indexed escrowId, address indexed buyer, uint256 bond)',
];

/**
 * Transaction classification for security:
 * - read: auto-approve (no state change)
 * - low_value: auto-approve with logging (identity registration, upload)
 * - financial: require explicit confirmation (fund, create, claim)
 */
export type TxClassification = 'read' | 'low_value' | 'financial';

export class DataEscrow {
  private provider: JsonRpcProvider;
  private contract: Contract;
  private wallet: Wallet | null;

  constructor(config: EscrowConfig = {}) {
    const rpcUrl = config.rpcUrl || process.env.BASE_RPC_URL || ADDRESSES.base.rpcUrl;
    const contractAddress = config.contractAddress || process.env.DATA_ESCROW_ADDRESS || ADDRESSES.base.escrowAddress;

    this.provider = new JsonRpcProvider(rpcUrl);

    if (config.privateKey || process.env.PRIVATE_KEY) {
      this.wallet = new Wallet((config.privateKey || process.env.PRIVATE_KEY)!, this.provider);
      this.contract = new Contract(contractAddress, DATA_ESCROW_ABI, this.wallet);
    } else {
      this.wallet = null;
      this.contract = new Contract(contractAddress, DATA_ESCROW_ABI, this.provider);
    }
  }

  get address(): string {
    return this.wallet?.address || '';
  }

  // ============ Write Operations (financial classification) ============

  /**
   * Create a new escrow for data sale.
   * Classification: financial
   */
  async createEscrow(params: {
    contentHash: string;
    keyCommitment: string;
    paymentToken?: string;
    amount: bigint;
    expiryDays?: number;
    metadataHash: string;
    category: string;
    expectedDataHash?: string;
    designatedBuyer?: string;
    fastSettle?: boolean;
  }): Promise<{ escrowId: string; txHash: string }> {
    this.requireWallet();

    const tx = await this.contract.createEscrow(
      params.contentHash,
      params.keyCommitment,
      params.paymentToken || TOKENS.NATIVE,
      params.amount,
      params.expiryDays || 7,
      params.metadataHash,
      params.category,
      params.expectedDataHash || ethers.ZeroHash,
      params.designatedBuyer || ethers.ZeroAddress,
      params.fastSettle || false,
    );
    const receipt = await tx.wait();

    const event = receipt.logs.find(
      (log: any) => log.fragment?.name === 'EscrowCreated',
    );
    const escrowId = event?.args?.[0]?.toString() || '0';

    return { escrowId, txHash: receipt.hash };
  }

  /**
   * Fund an escrow (buyer action).
   * Classification: financial
   */
  async fundEscrow(escrowId: string, amount: bigint, isERC20 = false): Promise<string> {
    this.requireWallet();

    let tx;
    if (isERC20) {
      tx = await this.contract.fundEscrowWithToken(escrowId);
    } else {
      tx = await this.contract.fundEscrow(escrowId, { value: amount });
    }
    const receipt = await tx.wait();
    return receipt.hash;
  }

  /**
   * Two-phase key release (seller action).
   * Phase 1: commit. Phase 2: reveal (after delay).
   * For fastSettle escrows, the delay is minimal.
   * Classification: financial
   */
  async releaseKey(
    escrowId: string,
    encryptedKeyForBuyer: Uint8Array,
  ): Promise<{ commitTxHash: string; revealTxHash: string }> {
    this.requireWallet();

    // Generate salt and commitment
    const salt = ethers.hexlify(ethers.randomBytes(32));
    const commitment = ethers.keccak256(
      ethers.concat([encryptedKeyForBuyer, ethers.getBytes(salt)]),
    );

    // Phase 1: Commit
    const commitTx = await this.contract.commitKeyRelease(escrowId, commitment);
    const commitReceipt = await commitTx.wait();

    // Wait for minimum delay (2 blocks + 60s on mainnet, less on Base)
    // Base has 2s block time, so 2 blocks = 4s. Total: ~64s.
    await this.waitForDelay(65_000);

    // Phase 2: Reveal
    const revealTx = await this.contract.revealKey(escrowId, encryptedKeyForBuyer, salt);
    const revealReceipt = await revealTx.wait();

    return {
      commitTxHash: commitReceipt.hash,
      revealTxHash: revealReceipt.hash,
    };
  }

  /**
   * Claim payment after dispute window (seller action).
   * Classification: financial
   */
  async claimPayment(escrowId: string): Promise<string> {
    this.requireWallet();
    const tx = await this.contract.claimPayment(escrowId);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  /**
   * Dispute an escrow (buyer action, requires bond).
   * Classification: financial
   */
  async dispute(escrowId: string, bondAmount: bigint): Promise<string> {
    this.requireWallet();
    const tx = await this.contract.disputeEscrow(escrowId, { value: bondAmount });
    const receipt = await tx.wait();
    return receipt.hash;
  }

  // ============ Read Operations (read classification) ============

  /**
   * Get escrow details.
   * Classification: read
   */
  async getEscrow(escrowId: string): Promise<EscrowDetails> {
    const result = await this.contract.getEscrow(escrowId);
    return {
      escrowId,
      seller: result.seller,
      buyer: result.buyer,
      paymentToken: result.paymentToken,
      contentHash: result.contentHash,
      keyCommitment: result.keyCommitment,
      expectedDataHash: ethers.ZeroHash, // TODO: add to view
      metadataHash: ethers.ZeroHash,     // TODO: add to view
      category: ethers.ZeroHash,         // TODO: add to view
      amount: result.amount,
      expiresAt: Number(result.expiresAt),
      state: Number(result.state) as EscrowState,
      fastSettle: false,                 // TODO: add to view
      designatedBuyer: ethers.ZeroAddress,
    };
  }

  /**
   * Query EscrowCreated events for discovery.
   * Classification: read
   */
  async queryEscrows(params: {
    category?: string;
    seller?: string;
    fromBlock?: number;
    toBlock?: number | 'latest';
  } = {}): Promise<Array<{
    escrowId: string;
    seller: string;
    category: string;
    metadataHash: string;
    amount: string;
    fastSettle: boolean;
  }>> {
    const filter = this.contract.filters.EscrowCreated(
      null,                                              // escrowId
      params.seller || null,                             // seller
      params.category ? ethers.id(params.category) : null, // category
    );

    const events = await this.contract.queryFilter(
      filter,
      params.fromBlock || -10000,  // Last ~10K blocks
      params.toBlock || 'latest',
    );

    return events.map((event: any) => ({
      escrowId: event.args[0].toString(),
      seller: event.args[1],
      category: event.args[2],
      metadataHash: event.args[6],
      amount: event.args[8].toString(),
      fastSettle: event.args[10],
    }));
  }

  // ============ Helpers ============

  classify(operation: string): TxClassification {
    const financial = ['createEscrow', 'fundEscrow', 'releaseKey', 'claimPayment', 'dispute'];
    const lowValue = ['registerIdentity', 'upload'];
    if (financial.includes(operation)) return 'financial';
    if (lowValue.includes(operation)) return 'low_value';
    return 'read';
  }

  private requireWallet(): void {
    if (!this.wallet) {
      throw new Error('Wallet required for write operations. Set PRIVATE_KEY env var.');
    }
  }

  private waitForDelay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
