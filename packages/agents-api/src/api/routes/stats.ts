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

  // GET /health
  router.get('/health', (_req, res) => {
    const indexerStatus = indexer.getStatus()
    res.json({
      status: 'ok',
      uptime: Math.floor((Date.now() - startedAt) / 1000),
      indexer: indexerStatus,
    })
  })

  return router
}
