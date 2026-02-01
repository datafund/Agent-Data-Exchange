/**
 * Reputation Score Calculator
 *
 * Score = completion(40%) + disputes(30%) + volume(15%) + age(10%) + speed(5%)
 *
 * Score range: 0-1000, starts at 500 for new entities.
 * Full algorithm kicks in after 3 escrows.
 */

import type { AgentsDatabase, AgentReputationRow, WalletReputationRow } from '../db/database.js'

export type ReputationTier = 'new' | 'bronze' | 'silver' | 'gold' | 'platinum'

export function scoreTier(score: number, totalEscrows: number): ReputationTier {
  if (totalEscrows === 0) return 'new'
  if (score >= 800) return 'platinum'
  if (score >= 600) return 'gold'
  if (score >= 400) return 'silver'
  return 'bronze'
}

export function scoreRecommendation(score: number, totalEscrows: number): 'proceed' | 'caution' | 'avoid' {
  if (totalEscrows === 0) return 'caution'
  if (score >= 600) return 'proceed'
  if (score >= 300) return 'caution'
  return 'avoid'
}

export class ReputationCalculator {
  constructor(private db: AgentsDatabase) {}

  /**
   * Compute reputation score from metrics
   */
  computeScore(metrics: {
    totalEscrows: number
    completionRate: number   // 0-1
    disputeRate: number      // 0-1
    totalVolumeWei: string
    firstEscrowAt: number | null
    avgDeliverySeconds: number | null
  }): number {
    // Cold start: return 500 for < 3 escrows
    if (metrics.totalEscrows < 3) return 500

    // Completion: 40% weight (0-400)
    const completion = metrics.completionRate * 400

    // Disputes: 30% weight (0-300). Lower dispute rate = higher score
    const disputes = (1 - metrics.disputeRate) * 300

    // Volume: 15% weight (0-150), log scale
    const volumeEth = parseFloat(metrics.totalVolumeWei) / 1e18
    const volume = Math.min(Math.log10(volumeEth + 1) * 50, 150)

    // Age: 10% weight (0-100), sqrt scale
    let age = 0
    if (metrics.firstEscrowAt) {
      const days = (Date.now() / 1000 - metrics.firstEscrowAt) / 86400
      age = Math.min(Math.sqrt(days) * 5, 100)
    }

    // Speed: 5% weight (0-50), 24h=50, 7d=0
    let speed = 0
    if (metrics.avgDeliverySeconds !== null) {
      const hours = metrics.avgDeliverySeconds / 3600
      speed = Math.max(0, Math.min(50, 50 - ((hours - 24) / (168 - 24)) * 50))
    }

    return Math.round(completion + disputes + volume + age + speed)
  }

  /**
   * Recalculate reputation for an ERC-8004 agent
   */
  recalculateAgent(agentId: number) {
    const stats = this.db.getAgentEscrowStats(agentId)
    const totalEscrows = stats.asSellerCreated + stats.asBuyerFunded
    const totalCompleted = stats.asSellerCompleted + stats.asBuyerCompleted
    const totalDisputed = stats.asSellerDisputed + stats.asBuyerDisputed

    const completionRate = totalEscrows > 0 ? totalCompleted / totalEscrows : 0
    const disputeRate = totalEscrows > 0 ? totalDisputed / totalEscrows : 0
    const cancellationRate = totalEscrows > 0 ? stats.asSellerCancelled / totalEscrows : 0

    const score = this.computeScore({
      totalEscrows,
      completionRate,
      disputeRate,
      totalVolumeWei: stats.totalVolume,
      firstEscrowAt: stats.firstEscrowAt,
      avgDeliverySeconds: stats.avgDeliverySeconds,
    })

    const rep: AgentReputationRow = {
      agent_id: agentId,
      total_created: stats.asSellerCreated,
      total_funded: stats.asBuyerFunded,
      total_completed: totalCompleted,
      total_disputed: totalDisputed,
      total_cancelled: stats.asSellerCancelled,
      total_volume: stats.totalVolume,
      volume_30d: '0', // TODO: compute 30d volume
      completion_rate: Math.round(completionRate * 10000),
      dispute_rate: Math.round(disputeRate * 10000),
      cancellation_rate: Math.round(cancellationRate * 10000),
      reputation_score: score,
      first_escrow_at: stats.firstEscrowAt,
      last_escrow_at: stats.lastEscrowAt,
    }

    this.db.upsertAgentReputation(rep)
  }

  /**
   * Recalculate reputation for a wallet address (both seller and buyer roles)
   */
  recalculateWallet(address: string) {
    if (!address || address === '') return

    for (const role of ['seller', 'buyer'] as const) {
      const stats = this.db.getWalletEscrowStats(address, role)
      if (stats.total === 0) continue

      const completionRate = stats.total > 0 ? stats.completed / stats.total : 0
      const disputeRate = stats.total > 0 ? stats.disputed / stats.total : 0
      const cancellationRate = stats.total > 0 ? stats.cancelled / stats.total : 0

      const score = this.computeScore({
        totalEscrows: stats.total,
        completionRate,
        disputeRate,
        totalVolumeWei: stats.totalVolume,
        firstEscrowAt: stats.firstEscrowAt,
        avgDeliverySeconds: stats.avgDeliverySeconds,
      })

      const rep: WalletReputationRow = {
        address: address.toLowerCase(),
        role,
        total_created: role === 'seller' ? stats.total : 0,
        total_funded: role === 'buyer' ? stats.total : 0,
        total_completed: stats.completed,
        total_disputed: stats.disputed,
        total_cancelled: stats.cancelled,
        total_volume: stats.totalVolume,
        volume_30d: '0',
        completion_rate: Math.round(completionRate * 10000),
        dispute_rate: Math.round(disputeRate * 10000),
        cancellation_rate: Math.round(cancellationRate * 10000),
        reputation_score: score,
        avg_delivery_seconds: stats.avgDeliverySeconds,
        first_escrow_at: stats.firstEscrowAt,
        last_escrow_at: stats.lastEscrowAt,
      }

      this.db.upsertWalletReputation(rep)
    }
  }
}
