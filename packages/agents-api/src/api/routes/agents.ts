import { Router } from 'express'
import type { AgentsDatabase } from '../../db/database.js'
import { scoreTier, scoreRecommendation } from '../../reputation/calculator.js'

export function agentRoutes(db: AgentsDatabase): Router {
  const router = Router()

  // GET /agents — list all agents with reputation
  router.get('/', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100)
    const offset = parseInt(req.query.offset as string) || 0
    const agents = db.listAgentReputations({ limit, offset })
    const total = db.countAgentReputations()
    res.json({
      agents: agents.map(a => {
        const totalEscrows = a.total_created + a.total_funded
        return {
          agentId: a.agent_id,
          score: a.reputation_score,
          tier: scoreTier(a.reputation_score, totalEscrows),
          totalCompleted: a.total_completed,
          totalDisputed: a.total_disputed,
          completionRate: a.completion_rate / 10000,
          totalVolume: a.total_volume,
          lastEscrowAt: a.last_escrow_at,
        }
      }),
      total,
      limit,
      offset,
    })
  })

  // GET /agents/:agentId/reputation
  router.get('/:agentId/reputation', (req, res) => {
    const agentId = parseInt(req.params.agentId, 10)
    if (isNaN(agentId)) return res.status(400).json({ error: 'Invalid agent ID' })

    const rep = db.getAgentReputation(agentId)
    if (!rep) {
      return res.json({
        agentId,
        score: 500,
        tier: 'new',
        recommendation: 'caution',
        metrics: {
          totalCreated: 0, totalFunded: 0, totalCompleted: 0,
          totalDisputed: 0, totalCancelled: 0,
          completionRate: 0, disputeRate: 0,
          totalVolume: '0',
        },
      })
    }

    const totalEscrows = rep.total_created + rep.total_funded
    res.json({
      agentId: rep.agent_id,
      score: rep.reputation_score,
      tier: scoreTier(rep.reputation_score, totalEscrows),
      recommendation: scoreRecommendation(rep.reputation_score, totalEscrows),
      metrics: {
        totalCreated: rep.total_created,
        totalFunded: rep.total_funded,
        totalCompleted: rep.total_completed,
        totalDisputed: rep.total_disputed,
        totalCancelled: rep.total_cancelled,
        completionRate: rep.completion_rate / 10000,
        disputeRate: rep.dispute_rate / 10000,
        totalVolume: rep.total_volume,
        firstEscrowAt: rep.first_escrow_at,
        lastEscrowAt: rep.last_escrow_at,
      },
    })
  })

  // GET /agents/:agentId/escrows
  router.get('/:agentId/escrows', (req, res) => {
    const agentId = parseInt(req.params.agentId, 10)
    if (isNaN(agentId)) return res.status(400).json({ error: 'Invalid agent ID' })

    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100)
    const offset = parseInt(req.query.offset as string) || 0

    const escrows = db.getEscrowsByAgent(agentId, { limit, offset })
    const total = db.countEscrowsByAgent(agentId)

    res.json({ escrows, total, limit, offset })
  })

  return router
}
