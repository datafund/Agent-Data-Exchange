/**
 * ERC-8004 Trustless Agents — Identity, Reputation, Validation.
 *
 * Abstracted behind AgentIdentity interface per evaluation mitigation M8.
 * If ERC-8004 changes, swap implementation without changing skill API.
 *
 * Pinned to deployed contracts on Sepolia.
 */

import { ethers, Contract, type Signer, type Provider } from 'ethers';
import { ADDRESSES } from './addresses.js';

// ============ Types ============

export interface AgentProfile {
  name: string;
  description: string;
  capabilities: string[];
  endpoint?: string;
  tags?: string[];
  /** Swarm reference to full profile JSON */
  profileRef?: string;
}

export interface ReputationSummary {
  count: number;
  averageScore: number;
  successfulDeliveries: number;
}

// ============ ABIs ============

const IDENTITY_ABI = [
  'function register(string tokenURI) external returns (uint256 agentId)',
  'function register(string tokenURI, tuple(string key, bytes value)[] metadata) external returns (uint256 agentId)',
  'function setMetadata(uint256 agentId, string key, bytes value) external',
  'function getMetadata(uint256 agentId, string key) external view returns (bytes)',
  'function totalAgents() external view returns (uint256)',
  'function agentExists(uint256 agentId) external view returns (bool)',
  'function ownerOf(uint256 agentId) external view returns (address)',
  'function tokenURI(uint256 agentId) external view returns (string)',
  'event Registered(uint256 indexed agentId, string tokenURI, address indexed owner)',
];

const REPUTATION_ABI = [
  'function giveFeedback(uint256 agentId, uint8 score, bytes32 tag1, bytes32 tag2, string fileuri, bytes32 filehash, bytes feedbackAuth) external',
  'function getSummary(uint256 agentId, address[] clientAddresses, bytes32 tag1, bytes32 tag2) external view returns (uint64 count, uint8 averageScore)',
  'function readAllFeedback(uint256 agentId, address[] clientAddresses, bytes32 tag1, bytes32 tag2, bool includeRevoked) external view returns (address[] clients, uint8[] scores, bytes32[] tag1s, bytes32[] tag2s, bool[] revokedStatuses)',
  'function getClients(uint256 agentId) external view returns (address[])',
  'event NewFeedback(uint256 indexed agentId, address indexed clientAddress, uint8 score, bytes32 indexed tag1, bytes32 tag2, string fileuri, bytes32 filehash)',
];

const VALIDATION_ABI = [
  'function isValidator(uint256 agentId, bytes32 capabilityHash) external view returns (bool)',
  'function getValidators(bytes32 capabilityHash) external view returns (uint256[])',
];

// ============ ERC-8004 Client ============

export class ERC8004 {
  private identity: Contract;
  private reputation: Contract;
  private validation: Contract;
  private provider: Provider;

  constructor(provider: Provider) {
    this.provider = provider;
    const addrs = ADDRESSES.erc8004;
    this.identity = new Contract(addrs.identityRegistry, IDENTITY_ABI, provider);
    this.reputation = new Contract(addrs.reputationRegistry, REPUTATION_ABI, provider);
    this.validation = new Contract(addrs.validationRegistry, VALIDATION_ABI, provider);
  }

  // ============ Identity ============

  /**
   * Register a new agent on-chain.
   * Returns the agent ID (ERC-721 token).
   */
  async register(
    signer: Signer,
    profile: AgentProfile,
  ): Promise<{ agentId: string; txHash: string }> {
    const tokenURI = this.profileToURI(profile);
    const metadata = [
      { key: 'capabilities', value: ethers.toUtf8Bytes(profile.capabilities.join(',')) },
    ];
    if (profile.endpoint) {
      metadata.push({ key: 'endpoint', value: ethers.toUtf8Bytes(profile.endpoint) });
    }

    const contract = this.identity.connect(signer);
    const tx = await contract['register(string,(string,bytes)[])'](tokenURI, metadata);
    const receipt = await tx.wait();

    const event = receipt.logs.find((log: any) => log.fragment?.name === 'Registered');
    const agentId = event?.args?.[0]?.toString() || '0';

    return { agentId, txHash: receipt.hash };
  }

  /**
   * Check if agent exists.
   */
  async exists(agentId: string): Promise<boolean> {
    return await this.identity.agentExists(BigInt(agentId));
  }

  /**
   * Get agent profile URI.
   */
  async getProfile(agentId: string): Promise<string> {
    return await this.identity.tokenURI(BigInt(agentId));
  }

  /**
   * Get agent metadata by key.
   */
  async getMetadata(agentId: string, key: string): Promise<string> {
    const bytes = await this.identity.getMetadata(BigInt(agentId), key);
    return ethers.toUtf8String(bytes);
  }

  /**
   * Get total registered agents.
   */
  async totalAgents(): Promise<number> {
    return Number(await this.identity.totalAgents());
  }

  // ============ Reputation ============

  /**
   * Get reputation summary for an agent.
   */
  async getReputation(agentId: string, tag?: string): Promise<ReputationSummary> {
    const tag1 = tag ? ethers.id(tag) : ethers.ZeroHash;
    const [count, averageScore] = await this.reputation.getSummary(
      BigInt(agentId), [], tag1, ethers.ZeroHash,
    );

    // Get delivery-specific count
    const [deliveryCount] = await this.reputation.getSummary(
      BigInt(agentId), [], ethers.id('successful-delivery'), ethers.ZeroHash,
    );

    return {
      count: Number(count),
      averageScore: Number(averageScore),
      successfulDeliveries: Number(deliveryCount),
    };
  }

  /**
   * Submit feedback after a transaction.
   */
  async submitFeedback(
    signer: Signer,
    agentId: string,
    score: number,
    tag: string,
    feedbackAuth: Uint8Array,
  ): Promise<string> {
    const contract = this.reputation.connect(signer);
    const tx = await contract.giveFeedback(
      BigInt(agentId),
      score,
      ethers.id(tag),
      ethers.ZeroHash,
      '',
      ethers.ZeroHash,
      feedbackAuth,
    );
    const receipt = await tx.wait();
    return receipt.hash;
  }

  /**
   * Create feedback authorization signature.
   * Agent signs to allow a client to submit feedback.
   */
  async createFeedbackAuth(
    agentSigner: Signer,
    clientAddress: string,
    agentId: string,
  ): Promise<Uint8Array> {
    const message = ethers.solidityPacked(
      ['address', 'uint256'],
      [clientAddress, BigInt(agentId)],
    );
    const messageHash = ethers.keccak256(message);
    const signature = await agentSigner.signMessage(ethers.getBytes(messageHash));
    return ethers.getBytes(signature);
  }

  // ============ Capability Search ============

  /**
   * Search for agents by capability.
   * Returns agent IDs of validators for a given capability.
   */
  async findByCapability(capability: string): Promise<string[]> {
    const capHash = ethers.id(capability);
    const agentIds = await this.validation.getValidators(capHash);
    return agentIds.map((id: bigint) => id.toString());
  }

  // ============ Helpers ============

  private profileToURI(profile: AgentProfile): string {
    // In production, upload to Swarm and return bzz:// URI
    // For now, data URI
    return `data:application/json,${encodeURIComponent(JSON.stringify(profile))}`;
  }
}
