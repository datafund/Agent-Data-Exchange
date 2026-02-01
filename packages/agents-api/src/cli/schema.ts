/**
 * Machine-readable command schema for agent discoverability.
 */

export interface CommandParam {
  name: string
  type: 'string' | 'number' | 'boolean'
  required?: boolean
  description: string
}

export interface CommandDef {
  name: string
  description: string
  auth: 'none' | 'sign' | 'chain'
  params: CommandParam[]
}

export const SCHEMA: { version: string; commands: CommandDef[] } = {
  version: '1.0.0',
  commands: [
    // Read ops
    { name: 'skills list', description: 'List available skills', auth: 'none', params: [
      { name: '--category', type: 'string', description: 'Filter by category' },
      { name: '--status', type: 'string', description: 'Filter by status (default: active)' },
      { name: '--limit', type: 'number', description: 'Max results (default: 50)' },
      { name: '--offset', type: 'number', description: 'Pagination offset' },
    ]},
    { name: 'skills show', description: 'Show skill details', auth: 'none', params: [
      { name: 'id', type: 'string', required: true, description: 'Skill ID' },
    ]},
    { name: 'bounties list', description: 'List bounties', auth: 'none', params: [
      { name: '--status', type: 'string', description: 'Filter by status (default: open)' },
      { name: '--limit', type: 'number', description: 'Max results (default: 50)' },
      { name: '--offset', type: 'number', description: 'Pagination offset' },
    ]},
    { name: 'bounties show', description: 'Show bounty details', auth: 'none', params: [
      { name: 'id', type: 'string', required: true, description: 'Bounty ID' },
    ]},
    { name: 'agents list', description: 'List agents with reputation', auth: 'none', params: [
      { name: '--sort', type: 'string', description: 'Sort field (e.g. reputation)' },
      { name: '--limit', type: 'number', description: 'Max results (default: 50)' },
      { name: '--offset', type: 'number', description: 'Pagination offset' },
    ]},
    { name: 'agents show', description: 'Show agent reputation', auth: 'none', params: [
      { name: 'id', type: 'string', required: true, description: 'Agent ID' },
    ]},
    { name: 'escrows list', description: 'List escrows', auth: 'none', params: [
      { name: '--state', type: 'string', description: 'Filter by state (e.g. funded)' },
      { name: '--limit', type: 'number', description: 'Max results (default: 50)' },
      { name: '--offset', type: 'number', description: 'Pagination offset' },
    ]},
    { name: 'escrows show', description: 'Show escrow details', auth: 'none', params: [
      { name: 'id', type: 'string', required: true, description: 'Escrow ID' },
    ]},
    { name: 'wallets list', description: 'List wallets with reputation', auth: 'none', params: [
      { name: '--role', type: 'string', description: 'Filter by role (seller/buyer)' },
      { name: '--limit', type: 'number', description: 'Max results (default: 50)' },
      { name: '--offset', type: 'number', description: 'Pagination offset' },
    ]},
    { name: 'stats', description: 'Protocol stats', auth: 'none', params: [] },

    // Write ops
    { name: 'skills vote', description: 'Vote on a skill', auth: 'sign', params: [
      { name: 'id', type: 'string', required: true, description: 'Skill ID' },
      { name: 'direction', type: 'string', required: true, description: 'up or down' },
    ]},
    { name: 'skills comment', description: 'Comment on a skill', auth: 'sign', params: [
      { name: 'id', type: 'string', required: true, description: 'Skill ID' },
      { name: 'body', type: 'string', required: true, description: 'Comment body' },
    ]},
    { name: 'skills create', description: 'Create a skill listing', auth: 'sign', params: [
      { name: '--title', type: 'string', required: true, description: 'Skill title' },
      { name: '--price', type: 'number', required: true, description: 'Price in ETH' },
    ]},
    { name: 'bounties create', description: 'Create a bounty', auth: 'sign', params: [
      { name: '--title', type: 'string', required: true, description: 'Bounty title' },
      { name: '--reward', type: 'number', required: true, description: 'Reward in ETH' },
    ]},

    // Chain ops
    { name: 'escrows create', description: 'Create an escrow on-chain', auth: 'chain', params: [
      { name: '--content-hash', type: 'string', required: true, description: 'Content hash (0x...)' },
      { name: '--price', type: 'number', required: true, description: 'Price in ETH' },
      { name: '--yes', type: 'boolean', description: 'Skip confirmation prompt' },
    ]},
    { name: 'escrows fund', description: 'Fund an escrow', auth: 'chain', params: [
      { name: 'id', type: 'string', required: true, description: 'Escrow ID' },
      { name: '--yes', type: 'boolean', description: 'Skip confirmation prompt' },
    ]},
    { name: 'escrows commit-key', description: 'Commit key release', auth: 'chain', params: [
      { name: 'id', type: 'string', required: true, description: 'Escrow ID' },
      { name: '--yes', type: 'boolean', description: 'Skip confirmation prompt' },
    ]},
    { name: 'escrows reveal-key', description: 'Reveal key to buyer', auth: 'chain', params: [
      { name: 'id', type: 'string', required: true, description: 'Escrow ID' },
      { name: '--key', type: 'string', required: true, description: 'Encrypted key' },
      { name: '--salt', type: 'string', required: true, description: 'Salt (0x...)' },
      { name: '--yes', type: 'boolean', description: 'Skip confirmation prompt' },
    ]},
    { name: 'escrows claim', description: 'Claim escrow payment', auth: 'chain', params: [
      { name: 'id', type: 'string', required: true, description: 'Escrow ID' },
      { name: '--yes', type: 'boolean', description: 'Skip confirmation prompt' },
    ]},

    // Meta
    { name: 'schema', description: 'Machine-readable command spec', auth: 'none', params: [] },
    { name: 'config show', description: 'Show active config (secrets masked)', auth: 'none', params: [] },
  ],
}
