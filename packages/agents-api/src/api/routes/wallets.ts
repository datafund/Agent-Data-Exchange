import { Router } from 'express'
import type { AgentsDatabase } from '../../db/database.js'
import { scoreTier, scoreRecommendation } from '../../reputation/calculator.js'

function formatWalletRep(rep: { reputation_score: number; total_created: number; total_funded: number; total_completed: number; total_disputed: number; total_cancelled: number; completion_rate: number; dispute_rate: number; total_volume: string; avg_delivery_seconds: number | null; first_escrow_at: number | null; last_escrow_at: number | null } | undefined) {
  if (!rep) return null
  const totalEscrows = rep.total_created + rep.total_funded
  return {
    score: rep.reputation_score,
    tier: scoreTier(rep.reputation_score, totalEscrows),
    recommendation: scoreRecommendation(rep.reputation_score, totalEscrows),
    metrics: {
      totalCompleted: rep.total_completed,
      totalDisputed: rep.total_disputed,
      totalCancelled: rep.total_cancelled,
      completionRate: rep.completion_rate / 10000,
      disputeRate: rep.dispute_rate / 10000,
      totalVolume: rep.total_volume,
      avgDeliverySeconds: rep.avg_delivery_seconds,
      firstEscrowAt: rep.first_escrow_at,
      lastEscrowAt: rep.last_escrow_at,
    },
  }
}

export function walletRoutes(db: AgentsDatabase): Router {
  const router = Router()

  // GET /wallets — list wallets with reputation
  router.get('/', (req, res) => {
    const role = req.query.role as string | undefined
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100)
    const offset = parseInt(req.query.offset as string) || 0
    const wallets = db.listWalletReputations({ role, limit, offset })
    const total = db.countWalletReputations(role)
    res.json({
      wallets: wallets.map(w => {
        const totalEscrows = w.total_created + w.total_funded
        return {
          address: w.address,
          role: w.role,
          score: w.reputation_score,
          tier: scoreTier(w.reputation_score, totalEscrows),
          totalCompleted: w.total_completed,
          totalDisputed: w.total_disputed,
          completionRate: w.completion_rate / 10000,
          totalVolume: w.total_volume,
          lastEscrowAt: w.last_escrow_at,
        }
      }),
      total,
      limit,
      offset,
    })
  })

  // GET /wallets/:address/reputation
  router.get('/:address/reputation', (req, res) => {
    const address = req.params.address.toLowerCase()
    if (!/^0x[0-9a-f]{40}$/.test(address)) {
      return res.status(400).json({ error: 'Invalid address' })
    }

    const { seller, buyer } = db.getWalletReputation(address)
    const bountyStats = db.getBountyStatsForWallet(address)
    res.json({
      address,
      seller: formatWalletRep(seller),
      buyer: formatWalletRep(buyer),
      bounties: bountyStats.total > 0 ? {
        totalPosted: bountyStats.total,
        fulfilled: bountyStats.fulfilled,
        expired: bountyStats.expired,
        cancelled: bountyStats.cancelled,
        fulfillmentRate: bountyStats.total > 0 ? bountyStats.fulfilled / bountyStats.total : 0,
      } : null,
    })
  })

  // GET /wallets/:address/escrows
  router.get('/:address/escrows', (req, res) => {
    const address = req.params.address.toLowerCase()
    if (!/^0x[0-9a-f]{40}$/.test(address)) {
      return res.status(400).json({ error: 'Invalid address' })
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100)
    const offset = parseInt(req.query.offset as string) || 0

    const escrows = db.getEscrowsByWallet(address, { limit, offset })
    const total = db.countEscrowsByWallet(address)

    res.json({ escrows, total, limit, offset })
  })

  return router
}
