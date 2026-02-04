import { Router } from 'express'
import type { AgentsDatabase } from '../../db/database.js'
import { scoreTier, scoreRecommendation } from '../../reputation/calculator.js'
import { sanitize, isValidAddress, verifyWalletSignature } from '../sanitize.js'

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

  // POST /agents/:agentId/vote — vote on an agent
  router.post('/:agentId/vote', async (req, res) => {
    const { voter, voterAgentId, value, signature } = req.body
    if (!isValidAddress(voter) || (value !== 1 && value !== -1)) {
      res.status(400).json({ error: 'valid voter address and value (+1 or -1) required' })
      return
    }
    if (!await verifyWalletSignature(voter, signature, `vote:${req.params.agentId}:${value}`)) {
      res.status(401).json({ error: 'Invalid signature' })
      return
    }
    db.upsertVote({ voter, voterAgentId, targetType: 'agent', targetId: req.params.agentId, value })
    const votes = db.getVoteSummary('agent', req.params.agentId)
    res.json(votes)
  })

  // GET /agents/:agentId/votes — get vote summary
  router.get('/:agentId/votes', (req, res) => {
    const votes = db.getVoteSummary('agent', req.params.agentId)
    res.json(votes)
  })

  // GET /agents/:agentId/comments — list comments
  router.get('/:agentId/comments', (req, res) => {
    const { limit, offset } = req.query
    const comments = db.listComments('agent', req.params.agentId, limit ? Number(limit) : 50, offset ? Number(offset) : 0)
    const total = db.countComments('agent', req.params.agentId)
    res.json({ comments, total })
  })

  // POST /agents/:agentId/comments — add comment
  router.post('/:agentId/comments', async (req, res) => {
    const { author, authorAgentId, body, signature } = req.body
    if (!isValidAddress(author) || !body) {
      res.status(400).json({ error: 'valid author address and body required' })
      return
    }
    if (!await verifyWalletSignature(author, signature, `comment:${req.params.agentId}:${body}`)) {
      res.status(401).json({ error: 'Invalid signature' })
      return
    }
    const result = db.addComment({ author, authorAgentId, targetType: 'agent', targetId: req.params.agentId, body: sanitize(body) })
    res.status(201).json(result)
  })

  return router
}
