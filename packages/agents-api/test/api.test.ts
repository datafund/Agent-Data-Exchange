import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { AgentsDatabase } from '../src/db/database.js'
import { EscrowIndexer } from '../src/indexer/escrow-indexer.js'
import { createServer } from '../src/api/server.js'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('API routes', () => {
  let db: AgentsDatabase
  let tmpDir: string
  let server: ReturnType<typeof createServer>

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'agents-api-test-'))
    db = new AgentsDatabase(join(tmpDir, 'test.db'))

    // Create a mock indexer
    const indexer = {
      getStatus: () => ({ chains: [] }),
      start: async () => {},
      stop: () => {},
    } as unknown as EscrowIndexer

    server = createServer(db, indexer)

    // Insert test data
    db.upsertEscrow({
      id: 1,
      chainId: 8453,
      seller: '0x1111111111111111111111111111111111111111',
      buyer: '0x2222222222222222222222222222222222222222',
      amount: '1000000000000000000',
      state: 'claimed',
      createdAt: 1700000000,
      fundedAt: 1700001000,
      releasedAt: 1700002000,
      claimedAt: 1700003000,
      completed: 1,
      sellerAgentId: 42,
    })
  })

  afterAll(() => {
    db.close()
    rmSync(tmpDir, { recursive: true })
  })

  // Use supertest-like approach with raw http
  async function request(path: string): Promise<{ status: number; body: any }> {
    return new Promise((resolve) => {
      const { createServer: httpServer } = require('http')
      const s = httpServer(server)
      s.listen(0, () => {
        const port = s.address().port
        fetch(`http://localhost:${port}${path}`)
          .then(async (res) => {
            const body = await res.json()
            s.close()
            resolve({ status: res.status, body })
          })
          .catch((err) => {
            s.close()
            resolve({ status: 500, body: { error: err.message } })
          })
      })
    })
  }

  it('GET /api/v1/health returns ok', async () => {
    const res = await request('/api/v1/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
  })

  it('GET /api/v1/escrows/1 returns escrow', async () => {
    const res = await request('/api/v1/escrows/1')
    expect(res.status).toBe(200)
    expect(res.body.id).toBe(1)
    expect(res.body.seller).toBe('0x1111111111111111111111111111111111111111')
  })

  it('GET /api/v1/escrows/999 returns 404', async () => {
    const res = await request('/api/v1/escrows/999')
    expect(res.status).toBe(404)
  })

  it('GET /api/v1/agents/42/reputation returns data', async () => {
    const res = await request('/api/v1/agents/42/reputation')
    expect(res.status).toBe(200)
    expect(res.body.agentId).toBe(42)
    expect(res.body.tier).toBeDefined()
  })

  it('GET /api/v1/wallets/0x1111111111111111111111111111111111111111/reputation returns data', async () => {
    const res = await request('/api/v1/wallets/0x1111111111111111111111111111111111111111/reputation')
    expect(res.status).toBe(200)
    expect(res.body.address).toBe('0x1111111111111111111111111111111111111111')
  })

  it('GET /api/v1/stats returns protocol stats', async () => {
    const res = await request('/api/v1/stats')
    expect(res.status).toBe(200)
    expect(res.body.total_escrows).toBeDefined()
  })
})
