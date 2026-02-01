/**
 * Agents API — Reputation Indexer & REST API for DataEscrowV3
 *
 * Starts the event indexer and HTTP server.
 */

import { loadConfig } from './config.js'
import { AgentsDatabase } from './db/database.js'
import { EscrowIndexer } from './indexer/escrow-indexer.js'
import { createServer } from './api/server.js'

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
const server = app.listen(config.port, () => {
  console.log(`[agents-api] API listening on http://localhost:${config.port}`)
})

// Graceful shutdown
function shutdown() {
  console.log('[agents-api] Shutting down...')
  indexer.stop()
  server.close(() => {
    db.close()
    process.exit(0)
  })
  // Force exit after 10s if server.close hangs
  setTimeout(() => {
    console.error('[agents-api] Forced shutdown after timeout')
    db.close()
    process.exit(1)
  }, 10_000).unref()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.on('unhandledRejection', (err) => {
  console.error('[agents-api] Unhandled rejection:', err)
})
