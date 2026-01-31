#!/usr/bin/env npx tsx
/**
 * Demo 1: Basic Escrow Flow
 *
 * Two agents performing a trustless data exchange:
 *
 * 1. Seller uploads encrypted data to Swarm
 * 2. Seller creates escrow on Base with content hash
 * 3. Buyer discovers the offering via search
 * 4. Buyer funds the escrow
 * 5. Seller releases decryption key (commit-reveal)
 * 6. Buyer decrypts and verifies data hash
 * 7. Seller claims payment
 *
 * Run: npx tsx demos/basic-escrow.ts
 * Requires: BASE_RPC_URL, SELLER_KEY, BUYER_KEY env vars
 */

import { ethers } from 'ethers';

// Simulated flow (no live contracts needed for demo)
async function main() {
  console.log('=== Fairdrop Agent Data Exchange: Basic Escrow Demo ===\n');

  // --- Setup ---
  const sellerKey = process.env.SELLER_KEY || ethers.Wallet.createRandom().privateKey;
  const buyerKey = process.env.BUYER_KEY || ethers.Wallet.createRandom().privateKey;
  const seller = new ethers.Wallet(sellerKey);
  const buyer = new ethers.Wallet(buyerKey);

  console.log(`Seller: ${seller.address}`);
  console.log(`Buyer:  ${buyer.address}\n`);

  // --- Step 1: Seller prepares data ---
  console.log('Step 1: Seller prepares data');
  const data = new TextEncoder().encode(JSON.stringify({
    title: 'European Carbon Credit Pricing Q4 2025',
    records: 1247,
    coverage: ['EU-ETS', 'UK-ETS', 'Swiss-ETS'],
    lastUpdated: '2025-12-31',
    sample: [
      { date: '2025-12-31', market: 'EU-ETS', price: 82.45, currency: 'EUR' },
      { date: '2025-12-30', market: 'EU-ETS', price: 81.90, currency: 'EUR' },
    ],
  }));

  const contentHash = ethers.keccak256(data);
  const encryptionKey = ethers.randomBytes(32);
  const keyCommitment = ethers.keccak256(encryptionKey);
  console.log(`  Content hash: ${contentHash.slice(0, 18)}...`);
  console.log(`  Size: ${data.length} bytes`);
  console.log(`  Encryption key generated\n`);

  // --- Step 2: Seller creates escrow ---
  console.log('Step 2: Seller creates escrow on Base');
  const price = ethers.parseEther('0.001'); // 0.001 ETH
  const category = ethers.id('carbon-markets');
  const metadataHash = ethers.keccak256(new TextEncoder().encode(JSON.stringify({
    title: 'EU Carbon Credit Pricing Q4 2025',
    description: '1,247 daily price records across EU-ETS, UK-ETS, Swiss-ETS',
    tags: ['carbon', 'climate', 'pricing', 'europe'],
  })));

  console.log(`  Price: 0.001 ETH`);
  console.log(`  Category: carbon-markets`);
  console.log(`  Metadata hash: ${metadataHash.slice(0, 18)}...`);
  console.log(`  Fast settle: false (24h dispute window)`);
  console.log(`  → Escrow #0 created (simulated)\n`);

  // --- Step 3: Buyer discovers offering ---
  console.log('Step 3: Buyer searches for carbon data');
  console.log('  Query: "carbon credit pricing europe"');
  console.log('  Channels: on-chain ✓ | moltbook ✓ | erc8004 ✓');
  console.log('  Results: 1 offering found');
  console.log('    [on-chain] EU Carbon Credit Pricing Q4 2025');
  console.log('    Price: 0.001 ETH | Category: carbon-markets');
  console.log('    Seller reputation: 85/100 (12 deliveries)\n');

  // --- Step 4: Buyer funds escrow ---
  console.log('Step 4: Buyer funds escrow #0');
  console.log(`  Amount: ${ethers.formatEther(price)} ETH`);
  console.log(`  Buyer: ${buyer.address}`);
  console.log(`  → Escrow funded (simulated)\n`);

  // --- Step 5: Seller releases key (commit-reveal) ---
  console.log('Step 5: Seller releases decryption key');
  const salt = ethers.randomBytes(32);
  const commitment = ethers.keccak256(
    ethers.concat([encryptionKey, salt]),
  );
  console.log('  Phase 1: Commit');
  console.log(`    Commitment: ${ethers.hexlify(commitment).slice(0, 18)}...`);
  console.log('  Waiting for block delay (2 blocks + 60s on mainnet)...');
  console.log('  Phase 2: Reveal');
  console.log(`    Key revealed for buyer (encrypted with buyer pubkey)`);
  console.log(`  → Key released (simulated)\n`);

  // --- Step 6: Buyer verifies and decrypts ---
  console.log('Step 6: Buyer verifies data hash');
  const downloadedHash = contentHash; // In reality, download from Swarm and hash
  const verified = downloadedHash === contentHash;
  console.log(`  Expected: ${contentHash.slice(0, 18)}...`);
  console.log(`  Got:      ${downloadedHash.slice(0, 18)}...`);
  console.log(`  Match: ${verified ? '✓' : '✗'}`);
  console.log(`  → Data decrypted successfully\n`);

  // --- Step 7: Seller claims payment ---
  console.log('Step 7: Seller claims payment (after 24h dispute window)');
  console.log(`  Seller receives: ${ethers.formatEther(price)} ETH`);
  console.log(`  → Payment claimed (simulated)\n`);

  // --- Summary ---
  console.log('=== Exchange Complete ===');
  console.log(`  Data: EU Carbon Credit Pricing Q4 2025 (${data.length} bytes)`);
  console.log(`  Price: ${ethers.formatEther(price)} ETH`);
  console.log(`  Verified: ${verified ? 'Content hash matches ✓' : 'MISMATCH ✗'}`);
  console.log(`  Settlement: Standard (24h dispute window)`);
  console.log(`  Channels used: on-chain discovery → escrow → Swarm delivery`);
}

main().catch(console.error);
