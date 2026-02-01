import { Router } from 'express'
import { timingSafeEqual } from 'crypto'
import type { AgentsDatabase } from '../../db/database.js'
import type { EscrowIndexer } from '../../indexer/escrow-indexer.js'

/**
 * Team dashboard API. Protected by SX_DASHBOARD_TOKEN env var.
 */
export function dashboardRoutes(db: AgentsDatabase, indexer: EscrowIndexer): Router {
  const router = Router()

  // Auth middleware (timing-safe comparison)
  router.use((req, res, next) => {
    const token = process.env.SX_DASHBOARD_TOKEN
    if (!token) return res.status(503).json({ error: 'Dashboard not configured' })

    const auth = req.headers.authorization ?? ''
    const expected = `Bearer ${token}`
    if (auth.length !== expected.length ||
        !timingSafeEqual(Buffer.from(auth), Buffer.from(expected))) {
      return res.status(401).json({ error: 'Invalid token' })
    }
    next()
  })

  // GET /dashboard/overview — all dashboard data in one call
  router.get('/overview', (_req, res) => {
    const stats = db.getProtocolStats()
    const funnel = db.getConversionFunnel()
    const timings = db.getAvgTimings()
    const stateDistribution = db.getEscrowStateDistribution()
    const timeline = db.getEscrowTimeline(30)
    const topAgents = db.getTopAgents(10)
    const recentEvents = db.getRecentEvents(30)
    const indexerStatus = indexer.getStatus()

    res.json({
      stats,
      funnel,
      timings,
      stateDistribution,
      timeline,
      topAgents,
      recentEvents,
      indexer: indexerStatus,
      generatedAt: new Date().toISOString(),
    })
  })

  return router
}
