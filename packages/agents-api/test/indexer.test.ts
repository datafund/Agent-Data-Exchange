import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { AgentsDatabase } from '../src/db/database.js'
import { ReputationCalculator } from '../src/reputation/calculator.js'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('Database + Reputation integration', () => {
  let db: AgentsDatabase
  let calc: ReputationCalculator
  let tmpDir: string

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'agents-indexer-test-'))
    db = new AgentsDatabase(join(tmpDir, 'test.db'))
    calc = new ReputationCalculator(db)
  })

  afterAll(() => {
    db.close()
    rmSync(tmpDir, { recursive: true })
  })

  it('inserts events idempotently', () => {
    const first = db.insertEvent({
      chainId: 8453, txHash: '0xabc', logIndex: 0,
      blockNumber: 100, blockTimestamp: 1700000000,
      escrowId: 1, eventType: 'created', eventData: { seller: '0x111' },
    })
    expect(first).toBe(true)

    // Duplicate should return false
    const second = db.insertEvent({
      chainId: 8453, txHash: '0xabc', logIndex: 0,
      blockNumber: 100, blockTimestamp: 1700000000,
      escrowId: 1, eventType: 'created', eventData: { seller: '0x111' },
    })
    expect(second).toBe(false)
  })

  it('upserts escrows and tracks state transitions', () => {
    db.upsertEscrow({
      id: 10, chainId: 8453,
      seller: '0xseller', amount: '1000000000000000000',
      state: 'created', createdAt: 1700000000,
      sellerAgentId: 5,
    })

    let escrow = db.getEscrow(10)!
    expect(escrow.state).toBe('created')
    expect(escrow.seller).toBe('0xseller')

    // Fund it
    db.upsertEscrow({
      id: 10, chainId: 8453,
      buyer: '0xbuyer', buyerAgentId: 6,
      state: 'funded', fundedAt: 1700001000,
    })

    escrow = db.getEscrow(10)!
    expect(escrow.state).toBe('funded')
    expect(escrow.buyer).toBe('0xbuyer')
    expect(escrow.time_to_fund).toBe(1000)

    // Complete it
    db.upsertEscrow({
      id: 10, chainId: 8453,
      state: 'released', releasedAt: 1700002000,
    })
    db.upsertEscrow({
      id: 10, chainId: 8453,
      state: 'claimed', claimedAt: 1700003000, completed: 1,
    })

    escrow = db.getEscrow(10)!
    expect(escrow.completed).toBe(1)
    expect(escrow.time_to_release).toBe(1000)
  })

  it('recalculates agent reputation', () => {
    // Create more escrows for agent 5 to pass cold start threshold
    for (let i = 11; i <= 14; i++) {
      db.upsertEscrow({
        id: i, chainId: 8453,
        seller: '0xseller', sellerAgentId: 5,
        amount: '1000000000000000000',
        state: 'claimed', createdAt: 1700000000 + i * 1000,
        fundedAt: 1700000000 + i * 1000 + 500,
        releasedAt: 1700000000 + i * 1000 + 1000,
        claimedAt: 1700000000 + i * 1000 + 2000,
        completed: 1,
      })
    }

    calc.recalculateAgent(5)
    const rep = db.getAgentReputation(5)!
    expect(rep.agent_id).toBe(5)
    expect(rep.total_created).toBeGreaterThan(0)
    expect(rep.reputation_score).toBeGreaterThan(500) // Should be above cold start
  })

  it('tracks monitor state', () => {
    db.setLastBlock(8453, 1000n)
    expect(db.getLastBlock(8453)).toBe(1000n)

    db.setLastBlock(8453, 2000n)
    expect(db.getLastBlock(8453)).toBe(2000n)
  })

  it('lists and counts escrows with filters', () => {
    const all = db.listEscrows({})
    expect(all.length).toBeGreaterThan(0)

    const bySeller = db.listEscrows({ seller: '0xseller' })
    expect(bySeller.length).toBeGreaterThan(0)

    const count = db.countEscrows({ seller: '0xseller' })
    expect(count).toBe(bySeller.length)
  })
})
