/**
 * Integration test: DataEscrow v2 on Ethereum Sepolia
 *
 * Tests both standard escrow (24h dispute window) and fast-settle (0 dispute window).
 *
 * Contract: 0xc69439e9206711EA11B1a9b2fE2D53F1630d038B (v2 with parametrized dispute window)
 *
 * PART 1: REVERT / ACCESS CONTROL (fast, no delays)
 * PART 2: CONCURRENT ESCROWS
 * PART 3: FAST-SETTLE — full lifecycle including claimPayment (no 24h wait!)
 * PART 4: STANDARD ESCROW — full lifecycle (90s commit-reveal delay)
 * PART 5: DISPUTE GUARD — fast-settle escrow rejects disputes
 */

import { ethers, Contract, Wallet, JsonRpcProvider } from 'ethers';

// ============ Config ============

const RPC = 'https://eth-sepolia.g.alchemy.com/v2/CP_HPZ76hYvOsDJrRyFbA';
const CONTRACT_ADDR = '0xc69439e9206711EA11B1a9b2fE2D53F1630d038B';
const SELLER_KEY = '0xc4cd2ed283d46af361315e6e6751b111c67f0bbecb98bc7079cbaa142956a07e';
const BUYER_KEY = '0x80e1efce56f7bfa4b63cdeb7d98272d03f9e2c5f0ec5a49afdee91bef4488197';

const ABI = [
  // Standard create (24h dispute window default)
  'function createEscrow(bytes32 contentHash, bytes32 keyCommitment, address paymentToken, uint256 amount, uint256 expiryDays) external returns (uint256)',
  // Custom dispute window (0 = fast settle)
  'function createEscrowWithTerms(bytes32 contentHash, bytes32 keyCommitment, address paymentToken, uint256 amount, uint256 expiryDays, uint256 disputeWindowSeconds) external returns (uint256)',
  'function fundEscrow(uint256 escrowId) external payable',
  'function commitKeyRelease(uint256 escrowId, bytes32 encryptedKeyCommitment) external',
  'function revealKey(uint256 escrowId, bytes calldata encryptedKeyForBuyer, bytes32 salt) external',
  'function claimPayment(uint256 escrowId) external',
  'function claimExpired(uint256 escrowId) external',
  'function disputeEscrow(uint256 escrowId) external payable',
  // v2: 9-field getEscrow with disputeWindow
  'function getEscrow(uint256 escrowId) external view returns (address seller, address buyer, address paymentToken, bytes32 contentHash, bytes32 keyCommitment, uint256 amount, uint256 expiresAt, uint256 disputeWindow, uint8 state)',
  'function nextEscrowId() external view returns (uint256)',
  'function paused() external view returns (bool)',
  'function DEFAULT_DISPUTE_WINDOW() external view returns (uint256)',
  'function MAX_DISPUTE_WINDOW() external view returns (uint256)',
  'event EscrowCreated(uint256 indexed escrowId, address indexed seller, address paymentToken, bytes32 contentHash, bytes32 keyCommitment, uint256 amount, uint256 expiresAt, uint256 disputeWindow)',
  'event EscrowFunded(uint256 indexed escrowId, address indexed buyer, uint256 amount)',
  'event KeyCommitted(uint256 indexed escrowId, bytes32 encryptedKeyCommitment, uint256 commitBlock, uint256 commitTimestamp)',
  'event KeyRevealed(uint256 indexed escrowId, bytes encryptedKeyForBuyer)',
  'event PaymentClaimed(uint256 indexed escrowId, address indexed seller, uint256 amount)',
];

const STATE = ['CREATED', 'FUNDED', 'KEY_COMMITTED', 'RELEASED', 'CLAIMED', 'EXPIRED', 'CANCELLED', 'DISPUTED'];
const NATIVE_TOKEN = ethers.ZeroAddress;

// ============ Test Helpers ============

let passed = 0;
let failed = 0;
let skipped = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.log(`  ✗ FAIL: ${msg}`);
    failed++;
  }
}

function skip(msg: string) {
  console.log(`  ⊘ SKIP: ${msg}`);
  skipped++;
}

async function expectRevert(fn: () => Promise<any>, expectedReason: string, msg: string): Promise<boolean> {
  try {
    const tx = await fn();
    if (tx?.wait) await tx.wait();
    console.log(`  ✗ FAIL: ${msg} (did not revert)`);
    failed++;
    return false;
  } catch (e: any) {
    const reason = e.reason || e.message || '';
    const fullMsg = JSON.stringify(e).toLowerCase();
    const expected = expectedReason.toLowerCase();
    if (reason.includes(expectedReason) || fullMsg.includes(expected)) {
      console.log(`  ✓ ${msg} (reverted: "${expectedReason}")`);
      passed++;
      return true;
    } else {
      console.log(`  ✗ FAIL: ${msg} (expected "${expectedReason}", got: "${reason.slice(0, 100)}")`);
      failed++;
      return false;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function createTestEscrow(
  sellerContract: Contract,
  price: bigint,
  expiryDays = 3,
): Promise<string> {
  const contentHash = ethers.keccak256(ethers.randomBytes(32));
  const keyCommitment = ethers.keccak256(ethers.randomBytes(32));
  const tx = await sellerContract.createEscrow(contentHash, keyCommitment, NATIVE_TOKEN, price, expiryDays);
  const receipt = await tx.wait();
  const event = receipt.logs.find((log: any) => log.fragment?.name === 'EscrowCreated');
  return event?.args?.[0]?.toString() || '';
}

// ============ Tests ============

async function main() {
  console.log('=== DataEscrow v2 Sepolia Integration Tests ===\n');

  const provider = new JsonRpcProvider(RPC);
  const seller = new Wallet(SELLER_KEY, provider);
  const buyer = new Wallet(BUYER_KEY, provider);
  console.log(`Seller: ${seller.address}`);
  console.log(`Buyer:  ${buyer.address}`);
  console.log(`Contract: ${CONTRACT_ADDR}`);

  const sellerBal = await provider.getBalance(seller.address);
  const buyerBal = await provider.getBalance(buyer.address);
  console.log(`Seller balance: ${ethers.formatEther(sellerBal)} ETH`);
  console.log(`Buyer balance:  ${ethers.formatEther(buyerBal)} ETH`);

  const minBal = ethers.parseEther('0.01');
  if (sellerBal < minBal || buyerBal < minBal) {
    console.log('\n✗ ABORT: Wallet balances too low. Need >= 0.01 ETH each.');
    process.exit(1);
  }
  console.log('');

  const sellerContract = new Contract(CONTRACT_ADDR, ABI, seller);
  const buyerContract = new Contract(CONTRACT_ADDR, ABI, buyer);
  const readContract = new Contract(CONTRACT_ADDR, ABI, provider);

  // ================================================================
  // PART 0: CONTRACT V2 VERIFICATION
  // ================================================================

  console.log('Test 1: Contract v2 status');
  const paused = await readContract.paused();
  assert(!paused, 'Contract is not paused');
  const defaultWindow = await readContract.DEFAULT_DISPUTE_WINDOW();
  assert(Number(defaultWindow) === 86400, `Default dispute window is 24h (${defaultWindow}s)`);
  const maxWindow = await readContract.MAX_DISPUTE_WINDOW();
  assert(Number(maxWindow) === 2592000, `Max dispute window is 30d (${maxWindow}s)`);
  const nextId = await readContract.nextEscrowId();
  console.log(`  Next escrow ID: ${nextId}`);

  // ================================================================
  // PART 1: REVERT / ACCESS CONTROL (fast)
  // ================================================================

  console.log('\nTest 2: Create escrow with amount below minimum');
  await expectRevert(
    () => sellerContract.createEscrow(
      ethers.keccak256(ethers.randomBytes(32)),
      ethers.keccak256(ethers.randomBytes(32)),
      NATIVE_TOKEN,
      ethers.parseEther('0.0001'),
      3,
    ),
    'Amount below minimum',
    'Rejects amount below MIN_AMOUNT_NATIVE',
  );

  console.log('\nTest 3: Create escrow with zero content hash');
  await expectRevert(
    () => sellerContract.createEscrow(ethers.ZeroHash, ethers.keccak256(ethers.randomBytes(32)), NATIVE_TOKEN, ethers.parseEther('0.001'), 3),
    'Invalid content hash',
    'Rejects zero content hash',
  );

  console.log('\nTest 4: Create escrow with zero key commitment');
  await expectRevert(
    () => sellerContract.createEscrow(ethers.keccak256(ethers.randomBytes(32)), ethers.ZeroHash, NATIVE_TOKEN, ethers.parseEther('0.001'), 3),
    'Invalid key commitment',
    'Rejects zero key commitment',
  );

  console.log('\nTest 5: Create escrow with invalid expiry');
  await expectRevert(
    () => sellerContract.createEscrow(ethers.keccak256(ethers.randomBytes(32)), ethers.keccak256(ethers.randomBytes(32)), NATIVE_TOKEN, ethers.parseEther('0.001'), 0),
    'Invalid expiry',
    'Rejects 0 expiry days',
  );
  await expectRevert(
    () => sellerContract.createEscrow(ethers.keccak256(ethers.randomBytes(32)), ethers.keccak256(ethers.randomBytes(32)), NATIVE_TOKEN, ethers.parseEther('0.001'), 366),
    'Invalid expiry',
    'Rejects >365 expiry days',
  );

  console.log('\nTest 6: Dispute window too long');
  await expectRevert(
    () => sellerContract.createEscrowWithTerms(
      ethers.keccak256(ethers.randomBytes(32)),
      ethers.keccak256(ethers.randomBytes(32)),
      NATIVE_TOKEN,
      ethers.parseEther('0.001'),
      3,
      2592001, // MAX_DISPUTE_WINDOW + 1
    ),
    'Dispute window too long',
    'Rejects dispute window > 30 days',
  );

  // Create access-control test escrow
  console.log('\nCreating test escrow for access control...');
  const acPrice = ethers.parseEther('0.001');
  const acEscrowId = await createTestEscrow(sellerContract, acPrice);
  console.log(`  Escrow ID: ${acEscrowId}`);

  console.log('\nTest 7: Seller cannot fund own escrow');
  await expectRevert(
    () => sellerContract.fundEscrow(acEscrowId, { value: acPrice }),
    'Seller cannot be buyer',
    'Seller cannot fund own escrow',
  );

  console.log('\nTest 8: Wrong funding amount');
  await expectRevert(
    () => buyerContract.fundEscrow(acEscrowId, { value: ethers.parseEther('0.002') }),
    'Incorrect payment amount',
    'Rejects too much',
  );
  await expectRevert(
    () => buyerContract.fundEscrow(acEscrowId, { value: ethers.parseEther('0.0005') }),
    'Incorrect payment amount',
    'Rejects too little',
  );

  console.log('\nTest 9: State guards');
  await expectRevert(
    () => sellerContract.commitKeyRelease(acEscrowId, ethers.keccak256(ethers.randomBytes(32))),
    'Invalid state',
    'Cannot commit on unfunded escrow',
  );
  await expectRevert(
    () => sellerContract.claimPayment(acEscrowId),
    'Invalid state',
    'Cannot claim on CREATED escrow',
  );

  // Fund for more tests
  const fundAcTx = await buyerContract.fundEscrow(acEscrowId, { value: acPrice });
  await fundAcTx.wait();

  console.log('\nTest 10: claimExpired on non-expired');
  await expectRevert(
    () => buyerContract.claimExpired(acEscrowId),
    'Not expired',
    'Cannot claim expired on non-expired escrow',
  );

  console.log('\nTest 11: Access control on funded escrow');
  await expectRevert(
    () => buyerContract.commitKeyRelease(acEscrowId, ethers.keccak256(ethers.randomBytes(32))),
    'Not seller',
    'Buyer cannot commit key',
  );
  await expectRevert(
    () => buyerContract.fundEscrow(acEscrowId, { value: acPrice }),
    'Invalid state',
    'Cannot double-fund',
  );

  // Commit for reveal tests
  console.log('\n  Committing key for reveal tests...');
  const acSalt = ethers.hexlify(ethers.randomBytes(32));
  const acKey = ethers.randomBytes(32);
  const acKeyBytes = ethers.getBytes(ethers.hexlify(acKey));
  const acCommitment = ethers.keccak256(ethers.concat([acKeyBytes, ethers.getBytes(acSalt)]));
  const commitAcTx = await sellerContract.commitKeyRelease(acEscrowId, acCommitment);
  await commitAcTx.wait();

  console.log('\nTest 12: Reveal too soon');
  await expectRevert(
    () => sellerContract.revealKey(acEscrowId, acKeyBytes, acSalt),
    'Reveal too soon',
    'Cannot reveal before delay',
  );

  console.log('\nTest 13: Buyer cannot reveal');
  await expectRevert(
    () => buyerContract.revealKey(acEscrowId, acKeyBytes, acSalt),
    'Not seller',
    'Buyer cannot reveal key',
  );

  // ================================================================
  // PART 2: CONCURRENT ESCROWS
  // ================================================================

  console.log('\nTest 14: Concurrent escrows');
  const concPrice = ethers.parseEther('0.001');
  const id1 = await createTestEscrow(sellerContract, concPrice);
  const id2 = await createTestEscrow(sellerContract, concPrice);
  assert(id1 !== id2, `Distinct IDs: ${id1} and ${id2}`);
  const fundConcTx = await buyerContract.fundEscrow(id1, { value: concPrice });
  await fundConcTx.wait();
  const e1 = await readContract.getEscrow(id1);
  const e2 = await readContract.getEscrow(id2);
  assert(Number(e1.state) === 1, 'Escrow 1 FUNDED');
  assert(Number(e2.state) === 0, 'Escrow 2 still CREATED');

  // ================================================================
  // PART 3: FAST-SETTLE — complete lifecycle with instant claim!
  // ================================================================

  console.log('\n--- Fast-Settle Escrow (disputeWindow=0) ---');

  console.log('\nTest 15: Create fast-settle escrow');
  const fsContentHash = ethers.keccak256(new TextEncoder().encode('fast settle test data'));
  const fsKey = ethers.randomBytes(32);
  const fsKeyCommitment = ethers.keccak256(fsKey);
  const fsPrice = ethers.parseEther('0.001');

  let fsEscrowId: string;
  try {
    const tx = await sellerContract.createEscrowWithTerms(
      fsContentHash, fsKeyCommitment, NATIVE_TOKEN, fsPrice, 3,
      0, // disputeWindowSeconds = 0 → fast settle
    );
    const receipt = await tx.wait();
    assert(receipt.status === 1, 'Create fast-settle escrow TX succeeded');
    const event = receipt.logs.find((log: any) => log.fragment?.name === 'EscrowCreated');
    fsEscrowId = event?.args?.[0]?.toString() || '';
    console.log(`  Escrow ID: ${fsEscrowId}`);

    // Verify disputeWindow is 0
    const fsEscrow = await readContract.getEscrow(fsEscrowId);
    assert(Number(fsEscrow.disputeWindow) === 0, 'Dispute window is 0 (fast settle)');
    assert(Number(fsEscrow.state) === 0, 'State is CREATED');
  } catch (e: any) {
    console.log(`  ✗ FAIL: ${e.message?.slice(0, 100)}`);
    failed++;
    return printSummary();
  }

  console.log('\nTest 16: Fund fast-settle escrow');
  try {
    const tx = await buyerContract.fundEscrow(fsEscrowId, { value: fsPrice });
    const receipt = await tx.wait();
    assert(receipt.status === 1, 'Fund TX succeeded');
  } catch (e: any) {
    console.log(`  ✗ FAIL: ${e.message?.slice(0, 100)}`);
    failed++;
    return printSummary();
  }

  console.log('\nTest 17: Commit key on fast-settle escrow');
  const fsSalt = ethers.hexlify(ethers.randomBytes(32));
  const fsKeyForBuyer = ethers.hexlify(fsKey);
  const fsKeyBytes = ethers.getBytes(fsKeyForBuyer);
  const fsCommitment = ethers.keccak256(ethers.concat([fsKeyBytes, ethers.getBytes(fsSalt)]));
  try {
    const tx = await sellerContract.commitKeyRelease(fsEscrowId, fsCommitment);
    const receipt = await tx.wait();
    assert(receipt.status === 1, 'Commit TX succeeded');
  } catch (e: any) {
    console.log(`  ✗ FAIL: ${e.message?.slice(0, 100)}`);
    failed++;
    return printSummary();
  }

  console.log('\nTest 18: Reveal key on fast-settle escrow (after delay)');
  console.log('  Waiting 90s for commit-reveal delay...');
  await sleep(90_000);

  try {
    const tx = await sellerContract.revealKey(fsEscrowId, fsKeyBytes, fsSalt);
    const receipt = await tx.wait();
    assert(receipt.status === 1, 'Reveal TX succeeded');
    const fsRevealed = await readContract.getEscrow(fsEscrowId);
    assert(Number(fsRevealed.state) === 3, 'State is RELEASED');
  } catch (e: any) {
    console.log(`  ✗ FAIL: ${e.message?.slice(0, 150)}`);
    failed++;
    return printSummary();
  }

  console.log('\nTest 19: Dispute rejected on fast-settle escrow');
  await expectRevert(
    () => buyerContract.disputeEscrow(fsEscrowId, { value: fsPrice * 5n / 100n }),
    'No disputes on fast-settle escrow',
    'Cannot dispute fast-settle escrow',
  );

  console.log('\nTest 20: claimPayment SUCCEEDS immediately on fast-settle!');
  const sellerBalBefore = await provider.getBalance(seller.address);
  try {
    const tx = await sellerContract.claimPayment(fsEscrowId);
    console.log(`  TX: ${tx.hash}`);
    const receipt = await tx.wait();
    assert(receipt.status === 1, 'claimPayment TX succeeded');

    const fsAfter = await readContract.getEscrow(fsEscrowId);
    assert(Number(fsAfter.state) === 4, `State is CLAIMED (${STATE[Number(fsAfter.state)]})`);

    // Verify seller received payment (minus gas)
    const sellerBalAfter = await provider.getBalance(seller.address);
    const gasUsed = receipt.gasUsed * receipt.gasPrice;
    const netReceived = sellerBalAfter - sellerBalBefore + gasUsed;
    assert(netReceived === fsPrice, `Seller received ${ethers.formatEther(netReceived)} ETH`);
  } catch (e: any) {
    console.log(`  ✗ FAIL: claimPayment failed: ${e.message?.slice(0, 150)}`);
    failed++;
    return printSummary();
  }

  // ================================================================
  // PART 4: STANDARD ESCROW (24h dispute window, happy path)
  // ================================================================

  console.log('\n--- Standard Escrow (24h dispute window) ---');

  console.log('\nTest 21: Create standard escrow');
  const stdContentHash = ethers.keccak256(new TextEncoder().encode('standard escrow test'));
  const stdKey = ethers.randomBytes(32);
  const stdKeyCommitment = ethers.keccak256(stdKey);
  const stdPrice = ethers.parseEther('0.001');

  let stdEscrowId: string;
  try {
    const tx = await sellerContract.createEscrow(stdContentHash, stdKeyCommitment, NATIVE_TOKEN, stdPrice, 3);
    const receipt = await tx.wait();
    assert(receipt.status === 1, 'Create standard escrow succeeded');
    const event = receipt.logs.find((log: any) => log.fragment?.name === 'EscrowCreated');
    stdEscrowId = event?.args?.[0]?.toString() || '';
    console.log(`  Escrow ID: ${stdEscrowId}`);

    const stdEscrow = await readContract.getEscrow(stdEscrowId);
    assert(Number(stdEscrow.disputeWindow) === 86400, 'Dispute window is 24h (default)');
  } catch (e: any) {
    console.log(`  ✗ FAIL: ${e.message?.slice(0, 100)}`);
    failed++;
    return printSummary();
  }

  console.log('\nTest 22: Fund + commit + reveal standard escrow');
  try {
    const fundTx = await buyerContract.fundEscrow(stdEscrowId, { value: stdPrice });
    await fundTx.wait();

    const stdSalt = ethers.hexlify(ethers.randomBytes(32));
    const stdKeyForBuyer = ethers.hexlify(stdKey);
    const stdKeyBytes = ethers.getBytes(stdKeyForBuyer);
    const stdCommitment = ethers.keccak256(ethers.concat([stdKeyBytes, ethers.getBytes(stdSalt)]));
    const commitTx = await sellerContract.commitKeyRelease(stdEscrowId, stdCommitment);
    await commitTx.wait();

    // acEscrow delay has been long enough, so std should also be fine
    // But let's wait a small amount just in case
    console.log('  Waiting 90s for commit-reveal delay...');
    await sleep(90_000);

    const revealTx = await sellerContract.revealKey(stdEscrowId, stdKeyBytes, stdSalt);
    const receipt = await revealTx.wait();
    assert(receipt.status === 1, 'Full cycle succeeded');

    const stdRevealed = await readContract.getEscrow(stdEscrowId);
    assert(Number(stdRevealed.state) === 3, 'State is RELEASED');
  } catch (e: any) {
    console.log(`  ✗ FAIL: ${e.message?.slice(0, 150)}`);
    failed++;
    return printSummary();
  }

  console.log('\nTest 23: claimPayment reverts on standard escrow (24h window)');
  await expectRevert(
    () => sellerContract.claimPayment(stdEscrowId),
    'Dispute window not closed',
    'Cannot claim before 24h dispute window',
  );

  // ================================================================
  // PART 5: WRONG SALT + CORRECT REVEAL on acEscrow
  // ================================================================

  console.log('\nTest 24: Wrong salt reveal');
  const wrongSalt = ethers.hexlify(ethers.randomBytes(32));
  await expectRevert(
    () => sellerContract.revealKey(acEscrowId, acKeyBytes, wrongSalt),
    'Invalid encrypted key',
    'Rejects wrong salt',
  );

  console.log('\nTest 25: Correct reveal on acEscrow after delay');
  try {
    const tx = await sellerContract.revealKey(acEscrowId, acKeyBytes, acSalt);
    const receipt = await tx.wait();
    assert(receipt.status === 1, 'Correct reveal succeeds');
  } catch (e: any) {
    if (e.message?.includes('Reveal too soon')) {
      skip('acEscrow delay not yet passed');
    } else {
      console.log(`  ✗ FAIL: ${e.message?.slice(0, 100)}`);
      failed++;
    }
  }

  // ================================================================
  // PART 6: CUSTOM DISPUTE WINDOW
  // ================================================================

  console.log('\nTest 26: Custom dispute window (1 hour)');
  try {
    const tx = await sellerContract.createEscrowWithTerms(
      ethers.keccak256(ethers.randomBytes(32)),
      ethers.keccak256(ethers.randomBytes(32)),
      NATIVE_TOKEN,
      ethers.parseEther('0.001'),
      3,
      3600, // 1 hour
    );
    const receipt = await tx.wait();
    assert(receipt.status === 1, 'Create escrow with 1h window succeeded');
    const event = receipt.logs.find((log: any) => log.fragment?.name === 'EscrowCreated');
    const customId = event?.args?.[0]?.toString() || '';
    const customEscrow = await readContract.getEscrow(customId);
    assert(Number(customEscrow.disputeWindow) === 3600, 'Dispute window is 3600s (1h)');
  } catch (e: any) {
    console.log(`  ✗ FAIL: ${e.message?.slice(0, 100)}`);
    failed++;
  }

  printSummary();
}

function printSummary() {
  console.log(`\n=== Results: ${passed} passed, ${failed} failed, ${skipped} skipped ===`);
  if (failed > 0) process.exit(1);
}

main().catch(e => {
  console.error('Test runner failed:', e);
  process.exit(1);
});
