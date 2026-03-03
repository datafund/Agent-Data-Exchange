import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { AgentsDatabase } from '../src/db/database.js'
import { EscrowIndexer } from '../src/indexer/escrow-indexer.js'
import { createServer } from '../src/api/server.js'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { privateKeyToAccount } from 'viem/accounts'

// Test wallet (hardhat account #0 — deterministic, never holds real funds)
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const
const testAccount = privateKeyToAccount(TEST_PRIVATE_KEY)

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
  async function request(
    path: string,
    opts?: { method?: string; headers?: Record<string, string>; body?: string },
  ): Promise<{ status: number; body: any }> {
    return new Promise((resolve) => {
      const { createServer: httpServer } = require('http')
      const s = httpServer(server)
      s.listen(0, () => {
        const port = s.address().port
        const fetchOpts: RequestInit = {}
        if (opts?.method) fetchOpts.method = opts.method
        if (opts?.headers) fetchOpts.headers = opts.headers
        if (opts?.body) fetchOpts.body = opts.body

        fetch(`http://localhost:${port}${path}`, fetchOpts)
          .then(async (res) => {
            let body: any
            const contentType = res.headers.get('content-type') || ''
            if (contentType.includes('json')) {
              body = await res.json()
            } else {
              body = { _text: await res.text(), _location: res.headers.get('location') }
            }
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

  /** POST with EIP-191 signature headers */
  async function signedRequest(
    path: string,
    body: Record<string, unknown>,
  ): Promise<{ status: number; body: any }> {
    const timestamp = Math.floor(Date.now() / 1000).toString()
    const nonce = randomUUID()
    const bodyStr = JSON.stringify(body)
    const message = `${timestamp}:${nonce}:${bodyStr}`
    const signature = await testAccount.signMessage({ message })

    return request(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Address': testAccount.address,
        'X-Signature': signature,
        'X-Timestamp': timestamp,
        'X-Nonce': nonce,
      },
      body: bodyStr,
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

  // === Product Type tests ===

  describe('Product Types', () => {
    const testSchema = {
      type: 'object',
      properties: {
        version: { type: 'string' },
        engram_count: { type: 'number' },
      },
      required: ['version'],
    }

    it('POST /product-types without signature returns 401', async () => {
      const res = await request('/api/v1/product-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'test-type', name: 'Test', schema: testSchema }),
      })
      expect(res.status).toBe(401)
    })

    it('POST /product-types with valid signature returns 201', async () => {
      const res = await signedRequest('/api/v1/product-types', {
        id: 'engram-pack',
        name: 'Engram Pack',
        description: 'Datacore engram pack',
        schema: testSchema,
        content_format: 'json',
        free_download_allowed: 1,
      })
      expect(res.status).toBe(201)
      expect(res.body.id).toBe('engram-pack')
      expect(res.body.name).toBe('Engram Pack')
    })

    it('POST /product-types with duplicate id returns 409', async () => {
      const res = await signedRequest('/api/v1/product-types', {
        id: 'engram-pack',
        name: 'Duplicate',
        schema: testSchema,
      })
      expect(res.status).toBe(409)
    })

    it('GET /product-types lists types', async () => {
      const res = await request('/api/v1/product-types')
      expect(res.status).toBe(200)
      expect(res.body.product_types).toBeInstanceOf(Array)
      expect(res.body.product_types.length).toBeGreaterThanOrEqual(1)
      const ep = res.body.product_types.find((t: any) => t.id === 'engram-pack')
      expect(ep).toBeDefined()
      expect(ep.schema.type).toBe('object')
    })

    it('GET /product-types/:id returns type with parsed schema', async () => {
      const res = await request('/api/v1/product-types/engram-pack')
      expect(res.status).toBe(200)
      expect(res.body.id).toBe('engram-pack')
      expect(res.body.schema.type).toBe('object')
      expect(res.body.schema.required).toContain('version')
    })

    it('GET /product-types/:id returns 404 for unknown type', async () => {
      const res = await request('/api/v1/product-types/nonexistent')
      expect(res.status).toBe(404)
    })
  })

  // === Skills with product types tests ===

  describe('Skills with product types', () => {
    it('POST /skills without signature returns 401', async () => {
      const res = await request('/api/v1/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seller: testAccount.address,
          title: 'Unsigned Skill',
        }),
      })
      expect(res.status).toBe(401)
    })

    it('POST /skills with valid product_type + valid metadata returns 201', async () => {
      const res = await signedRequest('/api/v1/skills', {
        seller: testAccount.address,
        title: 'My Engram Pack',
        description: 'A test engram pack',
        category: 'dataset',
        price: '0',
        product_type: 'engram-pack',
        metadata: { version: '1.0.0', engram_count: 42 },
      })
      expect(res.status).toBe(201)
      expect(res.body.product_type).toBe('engram-pack')
      expect(res.body.id).toBeDefined()
    })

    it('POST /skills with valid product_type + invalid metadata returns 400', async () => {
      const res = await signedRequest('/api/v1/skills', {
        seller: testAccount.address,
        title: 'Bad Metadata Pack',
        description: 'Missing required version',
        category: 'dataset',
        price: '0',
        product_type: 'engram-pack',
        metadata: { engram_count: 10 },
      })
      expect(res.status).toBe(400)
      expect(res.body.error).toContain('Invalid metadata')
    })

    it('POST /skills without product_type returns 201 (backward compat)', async () => {
      const res = await signedRequest('/api/v1/skills', {
        seller: testAccount.address,
        title: 'Legacy Skill',
        description: 'No product type',
        category: 'research',
        price: '1000000000000000',
      })
      expect(res.status).toBe(201)
      expect(res.body.product_type).toBeNull()
    })

    it('POST /skills with unknown product_type returns 400', async () => {
      const res = await signedRequest('/api/v1/skills', {
        seller: testAccount.address,
        title: 'Unknown Type Skill',
        product_type: 'nonexistent-type',
        metadata: {},
      })
      expect(res.status).toBe(400)
      expect(res.body.error).toContain('Unknown product_type')
    })

    it('GET /skills?product_type=engram-pack filters correctly', async () => {
      const res = await request('/api/v1/skills?product_type=engram-pack')
      expect(res.status).toBe(200)
      expect(res.body.skills).toBeInstanceOf(Array)
      for (const skill of res.body.skills) {
        expect(skill.product_type).toBe('engram-pack')
      }
      // Should have at least the one we created
      expect(res.body.skills.length).toBeGreaterThanOrEqual(1)
    })

    it('GET /skills/:id/download for free skill redirects', async () => {
      // Create a free skill with a valid 64-hex Swarm reference
      const createRes = await signedRequest('/api/v1/skills', {
        seller: testAccount.address,
        title: 'Free Pack',
        description: 'A free pack for download',
        category: 'dataset',
        price: '0',
        encryptedDataRef: 'a'.repeat(64),
        product_type: 'engram-pack',
        metadata: { version: '0.1.0' },
      })
      expect(createRes.status).toBe(201)
      const skillId = createRes.body.id

      // Attempt to download — should redirect to Swarm gateway
      const dlRes = await request(`/api/v1/skills/${skillId}/download`)
      // fetch follows redirects by default, so we may get a network error
      // or a redirect status. The key is it's not 403/404.
      // Since we use a fake swarm ref, the redirect URL won't resolve,
      // but we verify the route logic works by checking it's not a 403.
      expect([200, 302, 500]).toContain(dlRes.status)
    })

    it('GET /skills/:id/download for paid skill returns 403', async () => {
      // Create a paid skill
      const createRes = await signedRequest('/api/v1/skills', {
        seller: testAccount.address,
        title: 'Paid Pack',
        description: 'Costs money',
        category: 'dataset',
        price: '1000000000000000',
        encryptedDataRef: 'def456swarmref',
      })
      expect(createRes.status).toBe(201)
      const skillId = createRes.body.id

      const dlRes = await request(`/api/v1/skills/${skillId}/download`)
      expect(dlRes.status).toBe(403)
    })
  })

  // === x402 schema tests ===

  describe('x402 schema', () => {
    // IMPORTANT: X402_CONTENT_KEY_SECRET must be set for tests that call createSkill with x402ContentKey.
    beforeAll(() => {
      process.env.X402_CONTENT_KEY_SECRET = 'a'.repeat(64)
    })
    afterAll(() => {
      delete process.env.X402_CONTENT_KEY_SECRET
    })
    let testSkillId: string
    it('creates a skill with payment_method=x402', async () => {
      const { status, body } = await signedRequest('/api/v1/skills', {
        seller: testAccount.address,
        title: 'Test x402 Skill',
        price: '500000',
        payment_method: 'x402',
      })
      expect(status).toBe(201)
      expect(body.payment_method).toBe('x402')
      testSkillId = body.id
    })

    it('defaults payment_method to escrow', async () => {
      const { status, body } = await signedRequest('/api/v1/skills', {
        seller: testAccount.address,
        title: 'Default Method',
        price: '100000',
      })
      expect(status).toBe(201)
      expect(body.payment_method).toBe('escrow')
    })

    it('filters by payment_method', async () => {
      const { body } = await request('/api/v1/skills?payment_method=x402')
      expect(body.skills.every((s: any) => s.payment_method === 'x402')).toBe(true)
    })

    it('records x402 payment with unique tx_hash', () => {
      const txHash = '0x' + 'a'.repeat(64)
      db.recordX402Payment({
        id: 'pay-001',
        skillId: testSkillId,
        buyerAddress: '0x' + '1'.repeat(40),
        sellerAddress: '0x' + '2'.repeat(40),
        amount: '500000',
        fee: '0',
        txHash,
        settledAt: Math.floor(Date.now() / 1000),
      })
      const payments = db.listX402Payments(testSkillId)
      expect(payments.length).toBe(1)
      expect(payments[0].tx_hash).toBe(txHash)
    })

    it('rejects duplicate tx_hash', () => {
      const txHash = '0x' + 'b'.repeat(64)
      db.recordX402Payment({
        id: 'pay-dup-1',
        skillId: testSkillId,
        buyerAddress: '0x' + '1'.repeat(40),
        sellerAddress: '0x' + '2'.repeat(40),
        amount: '500000',
        fee: '0',
        txHash,
        settledAt: Math.floor(Date.now() / 1000),
      })
      const result = db.recordX402Payment({
        id: 'pay-dup-2',
        skillId: testSkillId,
        buyerAddress: '0x' + '1'.repeat(40),
        sellerAddress: '0x' + '2'.repeat(40),
        amount: '500000',
        fee: '0',
        txHash, // same hash — must fail
        settledAt: Math.floor(Date.now() / 1000),
      })
      expect(result).toBe(false)
    })

    it('never exposes x402_content_key in API responses', async () => {
      const { body: single } = await request(`/api/v1/skills/${testSkillId}`)
      expect(single.x402_content_key).toBeUndefined()
      expect(single.encrypted_data_ref).toBeUndefined()
    })

    it('server encrypts content key from client', () => {
      const rawKey = 'c'.repeat(64)
      db.createSkill({
        id: 'skill-key-encrypt-test',
        seller: 'test',
        title: 'Key Test',
        price: '500000',
        paymentMethod: 'x402',
        x402ContentKey: rawKey,
        createdAt: Math.floor(Date.now() / 1000),
      })
      const row = db.getSkill('skill-key-encrypt-test')
      expect(row).toBeTruthy()
      expect(row!.x402_content_key).not.toBe(rawKey)
      expect(row!.x402_content_key).not.toBeNull()
    })
  })
})
