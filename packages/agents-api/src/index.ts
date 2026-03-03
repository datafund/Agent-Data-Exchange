/**
 * Agents API — Reputation Indexer & REST API for DataEscrowV3
 *
 * Starts the event indexer and HTTP server.
 */

import { loadConfig } from './config.js'
import { AgentsDatabase } from './db/database.js'
import { EscrowIndexer } from './indexer/escrow-indexer.js'
import { createServer } from './api/server.js'
import { seedProductTypes } from './db/seed-product-types.js'

const config = loadConfig()

console.log('[agents-api] Starting...')
console.log(`[agents-api] DB: ${config.dbPath}`)
console.log(`[agents-api] Chains: ${config.chains.map(c => c.name).join(', ') || 'none configured'}`)
console.log(`[agents-api] Port: ${config.port}`)

const db = new AgentsDatabase(config.dbPath)

const indexer = new EscrowIndexer(
  db,
  config.chains,
  config.pollIntervalMs,
  config.catchupBatchSize,
)

// === x402 configuration validation ===
if (process.env.PAYMENT_PROXY_ADDRESS) {
  console.log('[x402] PaymentProxy:', process.env.PAYMENT_PROXY_ADDRESS)

  if (!process.env.X402_CONTENT_KEY_SECRET) {
    throw new Error('[x402] FATAL: X402_CONTENT_KEY_SECRET is required when PAYMENT_PROXY_ADDRESS is set. Generate with: openssl rand -hex 32')
  }
  if (!/^[0-9a-f]{64}$/i.test(process.env.X402_CONTENT_KEY_SECRET)) {
    throw new Error('[x402] FATAL: X402_CONTENT_KEY_SECRET must be exactly 64 hex characters (32 bytes). Generate with: openssl rand -hex 32')
  }

  const facilitatorUrl = process.env.X402_FACILITATOR_URL || 'https://x402.org/facilitator'
  try {
    const parsed = new URL(facilitatorUrl)
    if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
      throw new Error(`[x402] FATAL: Facilitator URL must use HTTPS for non-local hosts: ${facilitatorUrl}`)
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('FATAL')) throw err
    throw new Error(`[x402] FATAL: Invalid X402_FACILITATOR_URL: ${facilitatorUrl}`)
  }

  if (!process.env.RELAYER_KEY) {
    console.warn('[x402] WARNING: RELAYER_KEY not set — proxy.forward() will not work')
  } else if (!/^(0x)?[0-9a-f]{64}$/i.test(process.env.RELAYER_KEY)) {
    throw new Error('[x402] FATAL: RELAYER_KEY must be a 64-hex-char private key (with optional 0x prefix)')
  }
}

seedProductTypes(db)

const app = createServer(db, indexer)

// Start indexer
if (config.chains.length > 0) {
  indexer.start().catch(err => {
    console.error('[agents-api] Indexer start error:', err)
  })
} else {
  console.warn('[agents-api] No chains configured. Indexer not started. Set *_RPC_URL and *_ESCROW_CONTRACT env vars.')
}

// Start HTTP server
app.listen(config.port, () => {
  console.log(`[agents-api] API listening on http://localhost:${config.port}`)
})

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('[agents-api] Shutting down...')
  indexer.stop()
  db.close()
  process.exit(0)
})

process.on('SIGTERM', () => {
  console.log('[agents-api] Shutting down...')
  indexer.stop()
  db.close()
  process.exit(0)
})
