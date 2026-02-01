import { Router } from 'express'
import type { AgentsDatabase } from '../../db/database.js'
import type { EscrowIndexer } from '../../indexer/escrow-indexer.js'

const startedAt = Date.now()

export function statsRoutes(db: AgentsDatabase, indexer: EscrowIndexer): Router {
  const router = Router()

  // GET /stats
  router.get('/', (_req, res) => {
    const stats = db.getProtocolStats()
    res.json(stats)
  })

  // GET /health — structured health check for external monitoring
  router.get('/health', (_req, res) => {
    const indexerStatus = indexer.getStatus()
    const uptimeSeconds = Math.floor((Date.now() - startedAt) / 1000)

    // Detect indexer lag: if last poll was more than 3x the poll interval ago, it's stale
    const lagThreshold = indexerStatus.pollIntervalMs * 3
    const lastPollAge = indexerStatus.lastPollAt ? Date.now() - indexerStatus.lastPollAt : null
    const indexerHealthy = indexerStatus.running && (lastPollAge === null || lastPollAge < lagThreshold)

    const healthy = indexerStatus.chains.length > 0 && indexerHealthy

    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      uptime: uptimeSeconds,
      indexer: {
        running: indexerStatus.running,
        lastPollSecondsAgo: lastPollAge !== null ? Math.floor(lastPollAge / 1000) : null,
        healthy: indexerHealthy,
        chains: indexerStatus.chains,
      },
    })
  })

  return router
}
