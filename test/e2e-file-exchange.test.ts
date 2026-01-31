/**
 * End-to-end file exchange test: DataEscrow v2 on Ethereum Sepolia
 *
 * Proves the FULL flow that an agent would execute:
 *
 * SELLER:
 *   1. Has a data file (JSON knowledge payload)
 *   2. Generates AES-256-GCM symmetric key
 *   3. Encrypts file with symmetric key
 *   4. Computes contentHash = keccak256(encryptedFile)
 *   5. Computes keyCommitment = keccak256(symmetricKey)
 *   6. Creates fast-settle escrow on-chain
 *   7. "Uploads" encrypted file (simulated — in production goes to Swarm)
 *
 * BUYER:
 *   8. Sees escrow, verifies content hash
 *   9. Funds escrow
 *
 * SELLER:
 *  10. Derives ECDH shared secret (seller privkey + buyer pubkey)
 *  11. Encrypts symmetric key with shared secret (AES-256-GCM)
 *  12. Commits encrypted key hash on-chain
 *  13. Reveals encrypted key on-chain (after delay)
 *  14. Claims payment (fast settle)
 *
 * BUYER:
 *  15. Reads KeyRevealed event from chain
 *  16. Derives same ECDH shared secret (buyer privkey + seller pubkey)
 *  17. Decrypts symmetric key
 *  18. Downloads encrypted file (simulated)
 *  19. Decrypts file with symmetric key
 *  20. Verifies keccak256(encryptedFile) matches on-chain contentHash
 *  21. Reads the actual data
 *
 * Contract: 0xc69439e9206711EA11B1a9b2fE2D53F1630d038B (v2, fast-settle)
 */

import { ethers, Contract, Wallet, JsonRpcProvider, SigningKey } from 'ethers';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// ============ Config ============

const RPC = 'https://eth-sepolia.g.alchemy.com/v2/CP_HPZ76hYvOsDJrRyFbA';
const CONTRACT_ADDR = '0xc69439e9206711EA11B1a9b2fE2D53F1630d038B';
const SELLER_KEY = '0xc4cd2ed283d46af361315e6e6751b111c67f0bbecb98bc7079cbaa142956a07e';
const BUYER_KEY = '0x80e1efce56f7bfa4b63cdeb7d98272d03f9e2c5f0ec5a49afdee91bef4488197';

const ABI = [
  'function createEscrowWithTerms(bytes32 contentHash, bytes32 keyCommitment, address paymentToken, uint256 amount, uint256 expiryDays, uint256 disputeWindowSeconds) external returns (uint256)',
  'function fundEscrow(uint256 escrowId) external payable',
  'function commitKeyRelease(uint256 escrowId, bytes32 encryptedKeyCommitment) external',
  'function revealKey(uint256 escrowId, bytes calldata encryptedKeyForBuyer, bytes32 salt) external',
  'function claimPayment(uint256 escrowId) external',
  'function getEscrow(uint256 escrowId) external view returns (address seller, address buyer, address paymentToken, bytes32 contentHash, bytes32 keyCommitment, uint256 amount, uint256 expiresAt, uint256 disputeWindow, uint8 state)',
  'event EscrowCreated(uint256 indexed escrowId, address indexed seller, address paymentToken, bytes32 contentHash, bytes32 keyCommitment, uint256 amount, uint256 expiresAt, uint256 disputeWindow)',
  'event KeyRevealed(uint256 indexed escrowId, bytes encryptedKeyForBuyer)',
  'event PaymentClaimed(uint256 indexed escrowId, address indexed seller, uint256 amount)',
];

// ============ Crypto Helpers ============

/** AES-256-GCM encrypt */
function aesEncrypt(plaintext: Buffer, key: Buffer): { ciphertext: Buffer; iv: Buffer; tag: Buffer } {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext, iv, tag };
}

/** AES-256-GCM decrypt */
function aesDecrypt(ciphertext: Buffer, key: Buffer, iv: Buffer, tag: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/** Pack encrypted data: iv (12) + tag (16) + ciphertext */
function packEncrypted(enc: { ciphertext: Buffer; iv: Buffer; tag: Buffer }): Buffer {
  return Buffer.concat([enc.iv, enc.tag, enc.ciphertext]);
}

/** Unpack encrypted data */
function unpackEncrypted(packed: Buffer): { ciphertext: Buffer; iv: Buffer; tag: Buffer } {
  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(12, 28);
  const ciphertext = packed.subarray(28);
  return { ciphertext, iv, tag };
}

/**
 * ECDH shared secret using ethers.js SigningKey.
 * Both parties arrive at the same shared secret:
 *   sellerPriv * buyerPub = buyerPriv * sellerPub
 */
function ecdhSharedSecret(myPrivateKeyHex: string, theirPublicKeyHex: string): Buffer {
  const signingKey = new SigningKey(myPrivateKeyHex);
  const shared = signingKey.computeSharedSecret(theirPublicKeyHex);
  // Hash the shared point to get a 32-byte AES key
  return Buffer.from(ethers.getBytes(ethers.keccak256(shared)));
}

/** Get uncompressed public key hex from private key hex */
function getPublicKeyHex(privateKeyHex: string): string {
  return new SigningKey(privateKeyHex).publicKey;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============ Test ============

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.log(`  ✗ FAIL: ${msg}`);
    failed++;
  }
}

async function main() {
  console.log('=== End-to-End File Exchange Test ===\n');

  const provider = new JsonRpcProvider(RPC);
  const sellerWallet = new Wallet(SELLER_KEY, provider);
  const buyerWallet = new Wallet(BUYER_KEY, provider);

  const sellerContract = new Contract(CONTRACT_ADDR, ABI, sellerWallet);
  const buyerContract = new Contract(CONTRACT_ADDR, ABI, buyerWallet);
  const readContract = new Contract(CONTRACT_ADDR, ABI, provider);

  console.log(`Seller: ${sellerWallet.address}`);
  console.log(`Buyer:  ${buyerWallet.address}`);

  // Check balances
  const sellerBal = await provider.getBalance(sellerWallet.address);
  const buyerBal = await provider.getBalance(buyerWallet.address);
  console.log(`Seller balance: ${ethers.formatEther(sellerBal)} ETH`);
  console.log(`Buyer balance:  ${ethers.formatEther(buyerBal)} ETH`);

  if (sellerBal < ethers.parseEther('0.005') || buyerBal < ethers.parseEther('0.005')) {
    console.log('\n✗ ABORT: Insufficient balance.');
    process.exit(1);
  }

  // ============================================================
  // STEP 1: Seller prepares data
  // ============================================================

  console.log('\n--- Step 1: Seller prepares knowledge payload ---');

  const knowledgePayload = {
    title: 'Customer Escalation Playbook',
    version: '1.0.0',
    patterns: [
      { trigger: 'repeated complaint', action: 'escalate to supervisor', confidence: 0.92 },
      { trigger: 'legal threat', action: 'transfer to legal team', confidence: 0.97 },
      { trigger: 'social media mention', action: 'priority queue + PR review', confidence: 0.85 },
    ],
    metadata: {
      source: 'Analyzed 50,000 customer support conversations',
      created: new Date().toISOString(),
      seller: sellerWallet.address,
    },
  };

  const plaintext = Buffer.from(JSON.stringify(knowledgePayload, null, 2), 'utf-8');
  console.log(`  Payload size: ${plaintext.length} bytes`);
  console.log(`  Title: "${knowledgePayload.title}"`);
  console.log(`  Patterns: ${knowledgePayload.patterns.length}`);

  // ============================================================
  // STEP 2: Seller encrypts file with AES-256-GCM
  // ============================================================

  console.log('\n--- Step 2: Seller encrypts file ---');

  const symmetricKey = randomBytes(32);
  console.log(`  Symmetric key: ${symmetricKey.toString('hex').slice(0, 16)}...`);

  const encrypted = aesEncrypt(plaintext, symmetricKey);
  const encryptedFile = packEncrypted(encrypted);
  console.log(`  Encrypted file: ${encryptedFile.length} bytes (iv:12 + tag:16 + ciphertext:${encrypted.ciphertext.length})`);

  // ============================================================
  // STEP 3: Seller computes on-chain commitments
  // ============================================================

  console.log('\n--- Step 3: Seller computes commitments ---');

  const contentHash = ethers.keccak256(encryptedFile);
  const keyCommitment = ethers.keccak256(symmetricKey);
  console.log(`  contentHash: ${contentHash.slice(0, 20)}...`);
  console.log(`  keyCommitment: ${keyCommitment.slice(0, 20)}...`);

  // ============================================================
  // STEP 4: Seller creates fast-settle escrow on-chain
  // ============================================================

  console.log('\n--- Step 4: Create fast-settle escrow ---');

  const price = ethers.parseEther('0.001');
  let escrowId: string;

  try {
    const tx = await sellerContract.createEscrowWithTerms(
      contentHash,
      keyCommitment,
      ethers.ZeroAddress, // native ETH
      price,
      3, // 3 days expiry
      0, // fast settle
    );
    const receipt = await tx.wait();
    const event = receipt.logs.find((log: any) => log.fragment?.name === 'EscrowCreated');
    escrowId = event?.args?.[0]?.toString() || '';
    console.log(`  Escrow ID: ${escrowId}`);
    console.log(`  TX: ${tx.hash}`);
    assert(receipt.status === 1, 'Escrow created');
  } catch (e: any) {
    console.log(`  ✗ FAIL: ${e.message?.slice(0, 120)}`);
    failed++;
    return printSummary();
  }

  // Simulate "upload" — in production this goes to Swarm
  // The encrypted file would be stored at a Swarm reference
  const swarmSimulated = new Map<string, Buffer>();
  swarmSimulated.set(contentHash, encryptedFile);
  console.log('  "Uploaded" encrypted file (simulated Swarm storage)');

  // ============================================================
  // STEP 5: Buyer verifies listing and funds escrow
  // ============================================================

  console.log('\n--- Step 5: Buyer funds escrow ---');

  const escrowData = await readContract.getEscrow(escrowId);
  assert(escrowData.seller === sellerWallet.address, 'Seller address matches');
  assert(escrowData.contentHash === contentHash, 'Content hash matches listing');
  assert(escrowData.amount === price, `Price is ${ethers.formatEther(price)} ETH`);
  assert(Number(escrowData.disputeWindow) === 0, 'Fast settle (no dispute window)');

  try {
    const tx = await buyerContract.fundEscrow(escrowId, { value: price });
    const receipt = await tx.wait();
    assert(receipt.status === 1, 'Escrow funded');
  } catch (e: any) {
    console.log(`  ✗ FAIL: ${e.message?.slice(0, 120)}`);
    failed++;
    return printSummary();
  }

  // ============================================================
  // STEP 6: Seller encrypts symmetric key for buyer (ECDH)
  // ============================================================

  console.log('\n--- Step 6: Seller encrypts key for buyer (ECDH) ---');

  // Get public keys from private keys
  const sellerPubKey = getPublicKeyHex(SELLER_KEY);
  const buyerPubKey = getPublicKeyHex(BUYER_KEY);

  console.log(`  Seller pubkey: ${sellerPubKey.slice(0, 22)}...`);
  console.log(`  Buyer pubkey:  ${buyerPubKey.slice(0, 22)}...`);

  // Seller derives shared secret: sellerPriv * buyerPub
  const sellerSharedSecret = ecdhSharedSecret(SELLER_KEY, buyerPubKey);
  console.log(`  Seller shared secret: ${sellerSharedSecret.toString('hex').slice(0, 20)}...`);

  // Encrypt symmetric key with shared secret
  const encryptedSymKey = aesEncrypt(symmetricKey, sellerSharedSecret);
  const packedEncKey = packEncrypted(encryptedSymKey);
  console.log(`  Encrypted symmetric key: ${packedEncKey.length} bytes`);

  // ============================================================
  // STEP 7: Seller commits + reveals encrypted key on-chain
  // ============================================================

  console.log('\n--- Step 7: Commit-reveal encrypted key ---');

  const revealSalt = ethers.hexlify(randomBytes(32));
  const commitment = ethers.keccak256(
    ethers.concat([packedEncKey, ethers.getBytes(revealSalt)]),
  );

  try {
    const tx = await sellerContract.commitKeyRelease(escrowId, commitment);
    const receipt = await tx.wait();
    assert(receipt.status === 1, 'Key commitment submitted');
  } catch (e: any) {
    console.log(`  ✗ FAIL: ${e.message?.slice(0, 120)}`);
    failed++;
    return printSummary();
  }

  console.log('  Waiting 90s for commit-reveal delay...');
  await sleep(90_000);

  try {
    const tx = await sellerContract.revealKey(escrowId, packedEncKey, revealSalt);
    const receipt = await tx.wait();
    assert(receipt.status === 1, 'Key revealed on-chain');

    const revealed = await readContract.getEscrow(escrowId);
    assert(Number(revealed.state) === 3, 'State is RELEASED');
  } catch (e: any) {
    console.log(`  ✗ FAIL: ${e.message?.slice(0, 150)}`);
    failed++;
    return printSummary();
  }

  // ============================================================
  // STEP 8: Seller claims payment (fast settle — instant)
  // ============================================================

  console.log('\n--- Step 8: Seller claims payment ---');

  try {
    const tx = await sellerContract.claimPayment(escrowId);
    const receipt = await tx.wait();
    assert(receipt.status === 1, 'Payment claimed');
    console.log(`  TX: ${tx.hash}`);

    const claimed = await readContract.getEscrow(escrowId);
    assert(Number(claimed.state) === 4, 'State is CLAIMED');
  } catch (e: any) {
    console.log(`  ✗ FAIL: ${e.message?.slice(0, 120)}`);
    failed++;
    return printSummary();
  }

  // ============================================================
  // STEP 9: Buyer reads encrypted key from chain event
  // ============================================================

  console.log('\n--- Step 9: Buyer reads key from chain ---');

  const currentBlock = await provider.getBlockNumber();
  const filter = buyerContract.filters.KeyRevealed(escrowId);
  const events = await buyerContract.queryFilter(filter, currentBlock - 5, currentBlock);
  assert(events.length > 0, 'Found KeyRevealed event');

  const onChainEncryptedKey = (events[events.length - 1] as any).args[1];
  const encKeyBytes = ethers.getBytes(onChainEncryptedKey);
  console.log(`  Encrypted key from chain: ${encKeyBytes.length} bytes`);

  // ============================================================
  // STEP 10: Buyer derives shared secret and decrypts symmetric key
  // ============================================================

  console.log('\n--- Step 10: Buyer decrypts symmetric key (ECDH) ---');

  // Buyer derives same shared secret: buyerPriv * sellerPub
  const buyerSharedSecret = ecdhSharedSecret(BUYER_KEY, sellerPubKey);
  console.log(`  Buyer shared secret: ${buyerSharedSecret.toString('hex').slice(0, 20)}...`);

  // Verify ECDH: both sides get the same shared secret
  assert(
    sellerSharedSecret.toString('hex') === buyerSharedSecret.toString('hex'),
    'ECDH shared secrets match (seller == buyer)',
  );

  // Decrypt symmetric key
  const { ciphertext: encKeyCiphertext, iv: encKeyIv, tag: encKeyTag } = unpackEncrypted(Buffer.from(encKeyBytes));
  let recoveredSymKey: Buffer;
  try {
    recoveredSymKey = aesDecrypt(encKeyCiphertext, buyerSharedSecret, encKeyIv, encKeyTag);
    assert(recoveredSymKey.length === 32, 'Recovered 32-byte symmetric key');
    assert(
      recoveredSymKey.toString('hex') === symmetricKey.toString('hex'),
      'Recovered symmetric key matches original',
    );
  } catch (e: any) {
    console.log(`  ✗ FAIL: Key decryption failed: ${e.message}`);
    failed++;
    return printSummary();
  }

  // ============================================================
  // STEP 11: Buyer downloads and decrypts file
  // ============================================================

  console.log('\n--- Step 11: Buyer decrypts file ---');

  // "Download" from Swarm (simulated)
  const downloadedFile = swarmSimulated.get(contentHash);
  assert(downloadedFile !== undefined, 'Downloaded encrypted file from storage');

  // Verify content hash before decryption
  const downloadedHash = ethers.keccak256(downloadedFile!);
  assert(downloadedHash === contentHash, 'Content hash verified (file integrity)');

  // Decrypt file
  const { ciphertext, iv, tag } = unpackEncrypted(downloadedFile!);
  let decryptedData: Buffer;
  try {
    decryptedData = aesDecrypt(ciphertext, recoveredSymKey!, iv, tag);
    assert(decryptedData.length > 0, `Decrypted ${decryptedData.length} bytes`);
  } catch (e: any) {
    console.log(`  ✗ FAIL: File decryption failed: ${e.message}`);
    failed++;
    return printSummary();
  }

  // ============================================================
  // STEP 12: Buyer reads the actual data
  // ============================================================

  console.log('\n--- Step 12: Buyer reads knowledge payload ---');

  const recovered = JSON.parse(decryptedData.toString('utf-8'));
  assert(recovered.title === 'Customer Escalation Playbook', `Title: "${recovered.title}"`);
  assert(recovered.patterns.length === 3, `Patterns: ${recovered.patterns.length}`);
  assert(recovered.patterns[0].trigger === 'repeated complaint', `Pattern 1: "${recovered.patterns[0].trigger}"`);
  assert(recovered.patterns[1].confidence === 0.97, `Pattern 2 confidence: ${recovered.patterns[1].confidence}`);
  assert(recovered.metadata.seller === sellerWallet.address, 'Seller address in metadata matches');

  // Verify round-trip: original plaintext === decrypted
  assert(
    plaintext.toString('hex') === decryptedData.toString('hex'),
    'EXACT byte-for-byte match: original plaintext === decrypted output',
  );

  console.log('\n  Buyer now has the full knowledge payload:');
  console.log(`  ${JSON.stringify(recovered.patterns.map((p: any) => p.trigger))}`);

  printSummary();
}

function printSummary() {
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch(e => {
  console.error('Test runner failed:', e);
  process.exit(1);
});
