/**
 * Fairdrop OpenClaw Skill
 *
 * Full data exchange experience for AI agents:
 * - send: encrypted file to recipient
 * - publish: upload to Swarm, get public link
 * - download: fetch from Swarm reference
 * - sell: create escrow offering, auto-announce
 * - buy: fund escrow, receive decrypted data
 * - search: multi-channel discovery
 * - bounty: post data requirement with reward
 * - identity: ERC-8004 agent registration
 * - status: wallet, stamps, escrows overview
 */

export { FairdropSkill } from './skill.js';
export { type SkillConfig } from './config.js';
export { Wallet } from './wallet.js';
export { Stamps } from './stamps.js';
