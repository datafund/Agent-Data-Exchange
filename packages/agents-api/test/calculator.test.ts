import { describe, it, expect } from 'vitest'
import { ReputationCalculator, scoreTier, scoreRecommendation } from '../src/reputation/calculator.js'

describe('scoreTier', () => {
  it('returns new for 0 escrows', () => {
    expect(scoreTier(500, 0)).toBe('new')
  })

  it('returns bronze for low scores', () => {
    expect(scoreTier(200, 5)).toBe('bronze')
    expect(scoreTier(399, 5)).toBe('bronze')
  })

  it('returns silver for mid scores', () => {
    expect(scoreTier(400, 5)).toBe('silver')
    expect(scoreTier(599, 5)).toBe('silver')
  })

  it('returns gold for high scores', () => {
    expect(scoreTier(600, 5)).toBe('gold')
    expect(scoreTier(799, 5)).toBe('gold')
  })

  it('returns platinum for top scores', () => {
    expect(scoreTier(800, 5)).toBe('platinum')
    expect(scoreTier(1000, 5)).toBe('platinum')
  })
})

describe('scoreRecommendation', () => {
  it('returns caution for new entities', () => {
    expect(scoreRecommendation(500, 0)).toBe('caution')
  })

  it('returns proceed for good scores', () => {
    expect(scoreRecommendation(700, 10)).toBe('proceed')
  })

  it('returns caution for mid scores', () => {
    expect(scoreRecommendation(400, 10)).toBe('caution')
  })

  it('returns avoid for low scores', () => {
    expect(scoreRecommendation(200, 10)).toBe('avoid')
  })
})

describe('ReputationCalculator.computeScore', () => {
  // We can test computeScore without a db since it's a pure calculation
  const mockDb = {} as any
  const calc = new ReputationCalculator(mockDb)

  it('returns 500 for cold start (< 3 escrows)', () => {
    expect(calc.computeScore({
      totalEscrows: 0,
      completionRate: 0,
      disputeRate: 0,
      totalVolumeWei: '0',
      firstEscrowAt: null,
      avgDeliverySeconds: null,
    })).toBe(500)

    expect(calc.computeScore({
      totalEscrows: 2,
      completionRate: 1,
      disputeRate: 0,
      totalVolumeWei: '1000000000000000000',
      firstEscrowAt: Date.now() / 1000 - 86400,
      avgDeliverySeconds: 3600,
    })).toBe(500)
  })

  it('returns high score for perfect metrics', () => {
    const score = calc.computeScore({
      totalEscrows: 100,
      completionRate: 1.0,
      disputeRate: 0,
      totalVolumeWei: '100000000000000000000', // 100 ETH
      firstEscrowAt: Date.now() / 1000 - 365 * 86400, // 1 year ago
      avgDeliverySeconds: 3600, // 1 hour
    })
    // completion: 400, disputes: 300, volume: ~100, age: ~95, speed: 50
    expect(score).toBeGreaterThan(800)
  })

  it('returns low score for bad metrics', () => {
    const score = calc.computeScore({
      totalEscrows: 10,
      completionRate: 0.1,
      disputeRate: 0.9,
      totalVolumeWei: '10000000000000000', // 0.01 ETH
      firstEscrowAt: Date.now() / 1000 - 86400, // 1 day ago
      avgDeliverySeconds: 604800, // 7 days
    })
    expect(score).toBeLessThan(200)
  })

  it('handles medium metrics', () => {
    const score = calc.computeScore({
      totalEscrows: 20,
      completionRate: 0.7,
      disputeRate: 0.1,
      totalVolumeWei: '5000000000000000000', // 5 ETH
      firstEscrowAt: Date.now() / 1000 - 90 * 86400, // 90 days
      avgDeliverySeconds: 86400, // 24 hours
    })
    expect(score).toBeGreaterThan(400)
    expect(score).toBeLessThan(800)
  })
})
