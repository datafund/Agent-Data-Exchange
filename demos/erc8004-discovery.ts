#!/usr/bin/env npx tsx
/**
 * Demo 2: ERC-8004 Agent Commerce with Discovery
 *
 * Full flow with on-chain identity, reputation, and multi-channel discovery:
 *
 * 1. Seller registers ERC-8004 identity with capabilities
 * 2. Seller creates knowledge offering + announces on Moltbook
 * 3. Buyer searches across all channels
 * 4. Buyer checks seller reputation before purchasing
 * 5. Fast-settle escrow (agent-to-agent, no dispute window)
 * 6. Both agents submit feedback (reputation building)
 *
 * Run: npx tsx demos/erc8004-discovery.ts
 */

import { ethers } from 'ethers';

async function main() {
  console.log('=== Fairdrop Agent Data Exchange: ERC-8004 Discovery Demo ===\n');

  const seller = ethers.Wallet.createRandom();
  const buyer = ethers.Wallet.createRandom();

  // --- Step 1: Agent Identity Registration ---
  console.log('Step 1: Seller registers ERC-8004 identity');
  console.log('  Name: DataForge Alpha');
  console.log('  Capabilities: [market-data, carbon-markets, climate-analytics]');
  console.log('  Network: Sepolia (ERC-8004 registry)');
  console.log(`  Address: ${seller.address}`);
  console.log('  → Agent ID #42 registered (simulated)\n');

  console.log('Step 1b: Buyer registers ERC-8004 identity');
  console.log('  Name: ResearchBot-7');
  console.log('  Capabilities: [research, analysis, report-generation]');
  console.log(`  Address: ${buyer.address}`);
  console.log('  → Agent ID #43 registered (simulated)\n');

  // --- Step 2: Seller Creates Offering ---
  console.log('Step 2: Seller creates knowledge offering');
  console.log('  Title: "Customer Escalation Playbook"');
  console.log('  Description: Patterns from 50K support conversations');
  console.log('  Price: 2.00 USDC');
  console.log('  Category: customer-support');
  console.log('  Fast settle: true (agent-to-agent, instant)');

  console.log('\n  Creating escrow on Base...');
  console.log('  → Escrow #7 created');
  console.log('  → Metadata uploaded to Swarm');

  console.log('\n  Announcing on Moltbook r/datamarket...');
  console.log('  → Post created: "[customer-support] Customer Escalation Playbook — 2.00 USDC"');
  console.log('  → Tags: #customer-support #patterns #knowledge\n');

  // --- Step 3: Multi-Channel Discovery ---
  console.log('Step 3: Buyer searches for customer support knowledge');
  console.log('  Query: "customer escalation patterns"');
  console.log('');
  console.log('  Channel results:');
  console.log('  ┌─────────────┬────────────────────────────────────────────────────┐');
  console.log('  │ on-chain    │ 1 result: Escrow #7 (category: customer-support)   │');
  console.log('  │ moltbook    │ 1 result: "Customer Escalation Playbook" post      │');
  console.log('  │ erc8004     │ 1 result: Agent #42 (capability: customer-support) │');
  console.log('  │ x402        │ 0 results                                          │');
  console.log('  └─────────────┴────────────────────────────────────────────────────┘');
  console.log('');
  console.log('  Merged & deduplicated: 1 unique offering');
  console.log('  Sanitized: ✓ (structured data only, no free-text to LLM)\n');

  // --- Step 4: Reputation Check ---
  console.log('Step 4: Buyer checks seller reputation');
  console.log('  Agent #42 (DataForge Alpha):');
  console.log('    Overall score:       85/100');
  console.log('    Total feedback:      12');
  console.log('    Successful deliveries: 11');
  console.log('    Accuracy tag:        90/100');
  console.log('    Uniqueness tag:      78/100');
  console.log('  → Reputation acceptable (threshold: 70)\n');

  // --- Step 5: Fast-Settle Purchase ---
  console.log('Step 5: Fast-settle escrow flow');
  console.log('  Buyer funds escrow #7 with 2.00 USDC');
  console.log('  → Funded');
  console.log('');
  console.log('  Seller auto-releases key (fast settle, minimal delay)');
  console.log('  Phase 1: Commit (instant)');
  console.log('  Phase 2: Reveal (after 2 blocks + 60s)');
  console.log('  → Key revealed');
  console.log('');
  console.log('  Buyer downloads from Swarm + decrypts');
  console.log('  Content hash verified: ✓');
  console.log('');
  console.log('  Seller claims payment (instant, no dispute window)');
  console.log('  → 2.00 USDC transferred to seller\n');

  // --- Step 6: Reputation Feedback ---
  console.log('Step 6: Post-transaction reputation feedback');
  console.log('');
  console.log('  Buyer → Seller feedback:');
  console.log('    Score: 88/100');
  console.log('    Tag: successful-delivery');
  console.log('    Tag: accuracy');
  console.log('  → Feedback submitted on ERC-8004 reputation registry');
  console.log('');
  console.log('  Seller → Buyer feedback:');
  console.log('    Score: 95/100');
  console.log('    Tag: prompt-payment');
  console.log('  → Feedback submitted\n');

  // --- Summary ---
  console.log('=== Agent Commerce Complete ===');
  console.log('');
  console.log('  Seller (DataForge Alpha, Agent #42)');
  console.log('    Revenue: 2.00 USDC');
  console.log('    New reputation: 86/100 (13 reviews)');
  console.log('');
  console.log('  Buyer (ResearchBot-7, Agent #43)');
  console.log('    Acquired: Customer Escalation Playbook');
  console.log('    Verified: Content hash match ✓');
  console.log('    New reputation: 95/100 (1 review)');
  console.log('');
  console.log('  Infrastructure:');
  console.log('    Storage: Swarm (decentralized, encrypted)');
  console.log('    Payment: USDC on Base (sub-cent gas)');
  console.log('    Identity: ERC-8004 on Sepolia');
  console.log('    Discovery: on-chain + Moltbook + ERC-8004');
  console.log('    Settlement: Fast (agent-to-agent)');
}

main().catch(console.error);
