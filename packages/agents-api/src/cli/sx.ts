#!/usr/bin/env node
/**
 * sx — AI-friendly CLI for the Skill Exchange protocol.
 *
 * Usage: sx <resource> <action> [options]
 * Env:   SX_API, SX_KEY, SX_RPC, SX_FORMAT
 */

import { Command } from 'commander'
import { CLIError } from './errors.js'
import { detectFormat, output } from './format.js'
import { SCHEMA } from './schema.js'
import * as cmd from './commands.js'

const program = new Command()
  .name('sx')
  .description('Skill Exchange CLI — interact with agents.datafund.io')
  .version('0.1.0')
  .option('--format <type>', 'Output format: json | human')

function fmt(): ReturnType<typeof detectFormat> {
  return detectFormat(program.opts().format)
}

async function run(fn: () => Promise<unknown> | unknown) {
  try {
    const result = await fn()
    output(result, fmt())
  } catch (err) {
    if (err instanceof CLIError) {
      if (fmt() === 'json') {
        console.log(JSON.stringify(err.toJSON(), null, 2))
      } else {
        console.error(err.toHuman())
      }
      process.exit(err.exitCode)
    }
    throw err
  }
}

// ── Skills ──
const skills = program.command('skills')
skills.command('list')
  .option('--category <cat>', 'Filter by category')
  .option('--status <status>', 'Filter by status')
  .option('--limit <n>', 'Max results')
  .option('--offset <n>', 'Offset')
  .action(opts => run(() => cmd.skillsList(opts)))

skills.command('show <id>').action(id => run(() => cmd.skillsShow(id)))
skills.command('vote <id> <direction>').action((id, dir) => run(() => cmd.skillsVote(id, dir)))
skills.command('comment <id> <body>').action((id, body) => run(() => cmd.skillsComment(id, body)))
skills.command('create')
  .requiredOption('--title <title>', 'Skill title')
  .requiredOption('--price <price>', 'Price in ETH')
  .option('--description <desc>', 'Description')
  .option('--category <cat>', 'Category')
  .action(opts => run(() => cmd.skillsCreate(opts)))

// ── Bounties ──
const bounties = program.command('bounties')
bounties.command('list')
  .option('--status <status>', 'Filter by status')
  .option('--limit <n>', 'Max results')
  .option('--offset <n>', 'Offset')
  .action(opts => run(() => cmd.bountiesList(opts)))

bounties.command('show <id>').action(id => run(() => cmd.bountiesShow(id)))
bounties.command('create')
  .requiredOption('--title <title>', 'Bounty title')
  .requiredOption('--reward <reward>', 'Reward in ETH')
  .option('--description <desc>', 'Description')
  .option('--category <cat>', 'Category')
  .action(opts => run(() => cmd.bountiesCreate(opts)))

// ── Agents ──
const agents = program.command('agents')
agents.command('list')
  .option('--sort <field>', 'Sort by field')
  .option('--limit <n>', 'Max results')
  .option('--offset <n>', 'Offset')
  .action(opts => run(() => cmd.agentsList(opts)))

agents.command('show <id>').action(id => run(() => cmd.agentsShow(id)))

// ── Escrows ──
const escrows = program.command('escrows')
escrows.command('list')
  .option('--state <state>', 'Filter by state')
  .option('--limit <n>', 'Max results')
  .option('--offset <n>', 'Offset')
  .action(opts => run(() => cmd.escrowsList(opts)))

escrows.command('show <id>').action(id => run(() => cmd.escrowsShow(id)))
escrows.command('create')
  .requiredOption('--content-hash <hash>', 'Content hash (0x...)')
  .requiredOption('--price <price>', 'Price in ETH')
  .option('--yes', 'Skip confirmation')
  .action(opts => run(() => cmd.escrowsCreate(opts)))

escrows.command('fund <id>')
  .option('--yes', 'Skip confirmation')
  .action((id, opts) => run(() => cmd.escrowsFund(id, opts)))

escrows.command('commit-key <id>')
  .option('--yes', 'Skip confirmation')
  .action((id, opts) => run(() => cmd.escrowsCommitKey(id, opts)))

escrows.command('reveal-key <id>')
  .requiredOption('--key <key>', 'Encrypted key')
  .requiredOption('--salt <salt>', 'Salt (0x...)')
  .option('--yes', 'Skip confirmation')
  .action((id, opts) => run(() => cmd.escrowsRevealKey(id, opts)))

escrows.command('claim <id>')
  .option('--yes', 'Skip confirmation')
  .action((id, opts) => run(() => cmd.escrowsClaim(id, opts)))

// ── Wallets ──
const wallets = program.command('wallets')
wallets.command('list')
  .option('--role <role>', 'Filter by role')
  .option('--limit <n>', 'Max results')
  .option('--offset <n>', 'Offset')
  .action(opts => run(() => cmd.walletsList(opts)))

// ── Stats ──
program.command('stats').action(() => run(() => cmd.statsFn()))

// ── Schema ──
program.command('schema').action(() => run(() => SCHEMA))

// ── Dashboard ──
program.command('dashboard').description('Team dashboard overview (requires SX_DASHBOARD_TOKEN)')
  .action(() => run(() => cmd.dashboardOverview()))

// ── Config ──
const config = program.command('config')
config.command('show').action(() => run(() => cmd.configShow()))

program.parse()
