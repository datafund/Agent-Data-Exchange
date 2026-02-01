import { Router } from 'express'
import type { AgentsDatabase } from '../../db/database.js'

export function escrowRoutes(db: AgentsDatabase): Router {
  const router = Router()

  // GET /escrows/:escrowId
  router.get('/:escrowId', (req, res) => {
    const escrowId = parseInt(req.params.escrowId, 10)
    if (isNaN(escrowId)) return res.status(400).json({ error: 'Invalid escrow ID' })

    const escrow = db.getEscrow(escrowId)
    if (!escrow) return res.status(404).json({ error: 'Escrow not found' })

    res.json(escrow)
  })

  // GET /escrows?seller=&buyer=&state=&limit=&offset=
  router.get('/', (req, res) => {
    const { seller, buyer, state } = req.query as Record<string, string | undefined>
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100)
    const offset = parseInt(req.query.offset as string) || 0

    const escrows = db.listEscrows({ seller, buyer, state, limit, offset })
    const total = db.countEscrows({ seller, buyer, state })

    res.json({ escrows, total, limit, offset })
  })

  return router
}
