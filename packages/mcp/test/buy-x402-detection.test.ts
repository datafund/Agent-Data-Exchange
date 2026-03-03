import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

// Mock session
vi.mock('../src/session.js', () => ({
  session: {
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    publicKey: '04abcdef1234567890',
    requirePrivateKey: vi.fn(() => '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'),
    requireAddress: vi.fn(() => '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'),
    setEscrow: vi.fn(),
  },
}))

// Mock proxy (callRemoteTool)
vi.mock('../src/proxy.js', () => ({
  callRemoteTool: vi.fn(),
}))

// Mock tx-verify
vi.mock('../src/tx-verify.js', () => ({
  verifyTransaction: vi.fn(),
}))

// Mock signing tool
vi.mock('../src/tools/signing.js', () => ({
  signTransactionTool: {
    execute: vi.fn(),
  },
}))

// Import AFTER mocks
import { buyTool } from '../src/tools/buy.js'

// --- Test fixtures ---

const SKILL_ID = 'test-skill-x402'

// --- Tests ---

describe('df_buy x402 detection', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should detect x402 skill and return redirect message', async () => {
    // GET /skills/:id -> x402 skill
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        id: SKILL_ID,
        title: 'x402 Research Paper',
        payment_method: 'x402',
        price: '1000000',
      }),
    })

    const result = await buyTool.execute({
      skill_id: SKILL_ID,
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('x402')
    expect(result.error).toContain('df_buy_x402')
    expect(result.error).toContain(SKILL_ID)
    expect(result.payment_method).toBe('x402')
    expect(result.redirect_tool).toBe('df_buy_x402')

    // Should have only made one fetch call (skill details check)
    // No balance check, no purchase-info — early return
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch.mock.calls[0][0]).toContain(`/api/v1/skills/${SKILL_ID}`)
  })

  it('should include skill title in redirect message', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        id: SKILL_ID,
        title: 'My Cool Dataset',
        payment_method: 'x402',
      }),
    })

    const result = await buyTool.execute({
      skill_id: SKILL_ID,
    })

    expect(result.error).toContain('My Cool Dataset')
  })

  it('should continue to escrow flow when skill is not x402', async () => {
    // Call 1: GET /skills/:id -> escrow skill
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        id: SKILL_ID,
        title: 'Escrow Skill',
        payment_method: 'escrow',
      }),
    })

    // Call 2: purchase-info
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        escrow_id: '42',
        seller_address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        encrypted_data_ref: 'someref',
      }),
    })

    // After purchase-info, the escrow flow calls getBalance via viem (uses fetch internally).
    // viem will fail because our mock doesn't return proper RPC responses.
    // This proves we entered the escrow branch (not redirected to x402).
    await expect(
      buyTool.execute({ skill_id: SKILL_ID })
    ).rejects.toThrow()

    // First two calls should be skill details + purchase-info
    expect(mockFetch.mock.calls[0][0]).toContain(`/api/v1/skills/${SKILL_ID}`)
    expect(mockFetch.mock.calls[1][0]).toContain('/purchase-info')
  })

  it('should continue gracefully when skill lookup fails', async () => {
    // Call 1: GET /skills/:id -> 500 error
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    })

    // Call 2: purchase-info (fallback path)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        escrow_id: '42',
        seller_address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      }),
    })

    // Escrow flow continues and will fail at getBalance RPC call
    await expect(
      buyTool.execute({ skill_id: SKILL_ID })
    ).rejects.toThrow()

    // First two fetches should be skill lookup (failed) + purchase-info
    expect(mockFetch.mock.calls[0][0]).toContain(`/api/v1/skills/${SKILL_ID}`)
    expect(mockFetch.mock.calls[1][0]).toContain('/purchase-info')
  })

  it('should not check for x402 when escrow_id is provided directly', async () => {
    // When escrow_id is given, skip skill lookup entirely — go straight to escrow flow.
    // The escrow flow calls getBalance via viem (which uses fetch internally).
    // We verify no /api/v1/skills/ calls were made.
    await expect(
      buyTool.execute({ escrow_id: '42' })
    ).rejects.toThrow()

    // Verify none of the fetch calls were to /api/v1/skills/
    // (viem RPC calls go to mainnet.base.org, not our marketplace)
    const skillCalls = mockFetch.mock.calls.filter(
      (call: any) => typeof call[0] === 'string' && call[0].includes('/api/v1/skills/')
    )
    expect(skillCalls).toHaveLength(0)
  })

  it('should handle skill with no payment_method field', async () => {
    // Call 1: GET /skills/:id -> skill without payment_method
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        id: SKILL_ID,
        title: 'Legacy Skill',
        // no payment_method field
      }),
    })

    // Call 2: purchase-info
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        escrow_id: '99',
        seller_address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      }),
    })

    // Should fall through to escrow flow (not redirect)
    await expect(
      buyTool.execute({ skill_id: SKILL_ID })
    ).rejects.toThrow()

    // First two fetches: skill details + purchase-info
    expect(mockFetch.mock.calls[0][0]).toContain(`/api/v1/skills/${SKILL_ID}`)
    expect(mockFetch.mock.calls[1][0]).toContain('/purchase-info')
  })
})
