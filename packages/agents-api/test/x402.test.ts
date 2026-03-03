import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { AgentsDatabase } from '../src/db/database.js'

describe('x402 download paywall', () => {
  let db: AgentsDatabase
  let server: any
  let port: number
  let tmpDir: string

  const FREE_ID = 'skill-free-001'
  const X402_ID = 'skill-x402-001'
  const ESCROW_ID = 'skill-escrow-001'

  beforeAll(async () => {
    process.env.PAYMENT_PROXY_ADDRESS = '0x' + '1'.repeat(40)
    process.env.X402_CONTENT_KEY_SECRET = 'a'.repeat(64)
    process.env.X402_FACILITATOR_URL = 'http://mock-facilitator'

    tmpDir = mkdtempSync(join(tmpdir(), 'x402-test-'))
    db = new AgentsDatabase(join(tmpDir, 'test.db'))

    db.createSkill({
      id: FREE_ID,
      seller: '0xseller',
      title: 'Free Pack',
      price: '0',
      paymentMethod: 'free',
      encryptedDataRef: 'a'.repeat(64),
      createdAt: Math.floor(Date.now() / 1000),
    })

    db.createSkill({
      id: X402_ID,
      seller: '0xseller',
      title: 'Paid Pack',
      price: '500000',
      paymentMethod: 'x402',
      encryptedDataRef: 'b'.repeat(64),
      x402ContentKey: 'c'.repeat(64),
      createdAt: Math.floor(Date.now() / 1000),
    })

    db.createSkill({
      id: ESCROW_ID,
      seller: '0xseller',
      title: 'Escrow Pack',
      price: '10000000',
      paymentMethod: 'escrow',
      createdAt: Math.floor(Date.now() / 1000),
    })

    const { createServer } = await import('../src/api/server.js')
    const mockIndexer = {
      start: vi.fn(),
      stop: vi.fn(),
      getStatus: vi.fn().mockReturnValue({ chains: [], lastBlock: 0, isRunning: false }),
    } as any
    const app = createServer(db, mockIndexer)
    server = app.listen(0)
    port = (server.address() as any).port
  })

  afterAll(() => {
    server?.close()
    rmSync(tmpDir, { recursive: true })
    delete process.env.PAYMENT_PROXY_ADDRESS
    delete process.env.X402_CONTENT_KEY_SECRET
    delete process.env.X402_FACILITATOR_URL
  })

  it('returns 302 for free skill', async () => {
    const res = await fetch(
      `http://localhost:${port}/api/v1/skills/${FREE_ID}/download`,
      { redirect: 'manual' },
    )
    expect([200, 302]).toContain(res.status)
  })

  it('returns 403 for escrow skill', async () => {
    const res = await fetch(`http://localhost:${port}/api/v1/skills/${ESCROW_ID}/download`)
    expect(res.status).toBe(403)
  })

  it('returns 402 for x402 skill without payment header', async () => {
    const res = await fetch(`http://localhost:${port}/api/v1/skills/${X402_ID}/download`)
    expect(res.status).toBe(402)
    const body = await res.json() as any
    expect(body.x402Version).toBe(2)
    expect(body.paymentRequirements).toHaveLength(1)
    const req = body.paymentRequirements[0]
    expect(req.scheme).toBe('exact')
    expect(req.network).toBe('eip155:8453')
    expect(req.maxAmountRequired).toBe('500000')
    expect(req.extra.seller).toBe('0xseller')
    expect(req.extra.skillId).toBe(X402_ID)
  })

  it('does not expose content key in 402 response', async () => {
    const res = await fetch(`http://localhost:${port}/api/v1/skills/${X402_ID}/download`)
    const text = await res.text()
    expect(text).not.toContain('x402_content_key')
  })

  it('returns 404 for nonexistent skill', async () => {
    const res = await fetch(`http://localhost:${port}/api/v1/skills/nonexistent/download`)
    expect(res.status).toBe(404)
  })

  it('rejects duplicate tx_hash via recordX402Payment', () => {
    const txHash = '0x' + 'f'.repeat(64)
    db.recordX402Payment({
      id: 'pre-existing',
      skillId: X402_ID,
      buyerAddress: '0xbuyer',
      sellerAddress: '0xseller',
      amount: '500000',
      fee: '0',
      txHash,
      settledAt: Math.floor(Date.now() / 1000),
    })
    // recordX402Payment returns false on duplicate (not throw)
    const result = db.recordX402Payment({
      id: 'duplicate',
      skillId: X402_ID,
      buyerAddress: '0xbuyer',
      sellerAddress: '0xseller',
      amount: '500000',
      fee: '0',
      txHash,
      settledAt: Math.floor(Date.now() / 1000),
    })
    expect(result).toBe(false)
  })

  it('re-download rejects mismatched buyer address', async () => {
    const txHash = '0x' + 'd'.repeat(64)
    db.recordX402Payment({
      id: 'buyer-auth-test',
      skillId: X402_ID,
      buyerAddress: '0xrealbuyer',
      sellerAddress: '0xseller',
      amount: '500000',
      fee: '0',
      txHash,
      settledAt: Math.floor(Date.now() / 1000),
    })
    const res = await fetch(
      `http://localhost:${port}/api/v1/skills/${X402_ID}/download?tx_hash=${txHash}`,
      { headers: { 'X-Buyer-Address': '0xwrongbuyer' } }
    )
    expect(res.status).toBe(403)
  })

  it('re-download without X-Buyer-Address returns 401', async () => {
    const txHash = '0x' + 'e'.repeat(64)
    db.recordX402Payment({
      id: 'redownload-no-header',
      skillId: X402_ID,
      buyerAddress: '0xbuyer',
      sellerAddress: '0xseller',
      amount: '500000',
      fee: '0',
      txHash,
      settledAt: Math.floor(Date.now() / 1000),
    })
    const res = await fetch(
      `http://localhost:${port}/api/v1/skills/${X402_ID}/download?tx_hash=${txHash}`
    )
    expect(res.status).toBe(401)
    const body = await res.json() as any
    expect(body.error).toContain('X-Buyer-Address')
  })

  it('re-download with valid tx_hash and buyer address reaches Swarm', async () => {
    const txHash = '0x' + 'e'.repeat(64)
    const res = await fetch(
      `http://localhost:${port}/api/v1/skills/${X402_ID}/download?tx_hash=${txHash}`,
      { headers: { 'X-Buyer-Address': '0xbuyer' } }
    )
    // Passes auth check; Swarm unreachable in test -> 502
    expect(res.status).toBe(502)
  })
})
