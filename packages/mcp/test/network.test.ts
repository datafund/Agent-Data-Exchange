import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateCardTool, initiateExchangeTool } from '../src/tools/network.js'

// Mock fetch for API calls
const mockFetch = vi.fn()
global.fetch = mockFetch

// Mock session
vi.mock('../src/session.js', () => ({
  session: {
    address: '0x1234567890123456789012345678901234567890',
    subdomain: 'testagent',
    privateKey: 'abc123',
    publicKey: 'def456',
  },
}))

describe('df_generate_card', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should generate a valid agent card', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/reputation')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            seller: { reputation_score: 85, total_completed: 10 },
            tier: 'trusted',
          }),
        })
      }
      if (url.includes('/skills')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            skills: [
              { title: 'Research Report', category: 'research', price: '1000000000000000000' },
            ],
          }),
        })
      }
      return Promise.resolve({ ok: false })
    })

    const result = await generateCardTool.execute({
      categories: ['research', 'code'],
      seeking: ['dataset'],
      custom_message: 'Hello, I am a research agent!',
    })

    expect(result).toHaveProperty('card')
    expect(result).toHaveProperty('share_text')
    expect(result.card.type).toBe('datafund_agent_card')
    expect(result.card.version).toBe('1.0')
    expect(result.card.capabilities.categories).toContain('research')
    expect(result.card.capabilities.seeking).toContain('dataset')
  })

  it('should include exchange protocol information', async () => {
    mockFetch.mockResolvedValue({ ok: false })

    const result = await generateCardTool.execute({})

    expect(result.card.exchange_protocol).toBeDefined()
    expect(result.card.exchange_protocol.escrow_contract).toBeDefined()
    expect(result.card.exchange_protocol.mcp_install).toContain('npx')
  })

  it('should include identity information from session', async () => {
    mockFetch.mockResolvedValue({ ok: false })

    const result = await generateCardTool.execute({})

    expect(result.card.identity).toBeDefined()
    expect(result.card.identity.address).toBe('0x1234567890123456789012345678901234567890')
    expect(result.card.identity.ens).toBe('testagent.fds.eth')
  })

  it('should generate human-readable share text', async () => {
    mockFetch.mockResolvedValue({ ok: false })

    const result = await generateCardTool.execute({
      categories: ['research'],
      custom_message: 'Let\'s trade!',
    })

    expect(result.share_text).toContain('Datafund Agent Card')
    expect(result.share_text).toContain('I can provide')
    expect(result.share_text).toContain('Let\'s trade!')
  })

  it('should handle API errors gracefully', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'))

    const result = await generateCardTool.execute({})

    // Should still return a valid card even if API calls fail
    expect(result).toHaveProperty('card')
    expect(result.card.identity.address).toBeDefined()
  })
})

describe('df_initiate_exchange', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('should create an offer in phase 1', async () => {
    const result = await initiateExchangeTool.execute({
      name: 'Climate Research Report',
      description: 'Comprehensive climate data analysis',
      price_wei: '1000000000000000000',
      category: 'research',
      tags: ['climate', 'data'],
    })

    expect(result.phase).toBe(1)
    expect(result.status).toBe('offer_created')
    expect(result.offer_id).toBeDefined()
    expect(result.offer_details.name).toBe('Climate Research Report')
    expect(result.share_message).toContain('Climate Research Report')
  })

  it('should require name, description, price for phase 1', async () => {
    const result = await initiateExchangeTool.execute({
      name: 'Test',
      // Missing description and price
    })

    expect(result).toHaveProperty('error')
    expect(result.error).toContain('requires')
  })

  it('should include price in ETH in phase 1 response', async () => {
    const result = await initiateExchangeTool.execute({
      name: 'Test Offer',
      description: 'Test description',
      price_wei: '1000000000000000000', // 1 ETH
    })

    expect(result.offer_details.price_eth).toBe('1')
  })

  it('should handle phase 2 with valid offer_id', async () => {
    // First create an offer
    const phase1 = await initiateExchangeTool.execute({
      name: 'Test Data',
      description: 'Test description',
      price_wei: '500000000000000000',
      category: 'dataset',
    })

    // Then try to finalize with content
    const phase2 = await initiateExchangeTool.execute({
      offer_id: phase1.offer_id,
      content_base64: 'SGVsbG8gV29ybGQ=', // "Hello World" in base64
    })

    expect(phase2.phase).toBe(2)
    expect(phase2.status).toBe('ready_to_sell')
    expect(phase2.next_step).toContain('df_sell')
  })

  it('should return error for invalid offer_id', async () => {
    const result = await initiateExchangeTool.execute({
      offer_id: 'non-existent-offer-id',
      content_base64: 'SGVsbG8=',
    })

    expect(result).toHaveProperty('error')
    expect(result.error).toContain('not found')
  })

  it('should require content_base64 in phase 2', async () => {
    // First create an offer
    const phase1 = await initiateExchangeTool.execute({
      name: 'Test',
      description: 'Test',
      price_wei: '100000000000000000',
    })

    // Try phase 2 without content
    const phase2 = await initiateExchangeTool.execute({
      offer_id: phase1.offer_id,
    })

    expect(phase2).toHaveProperty('error')
    expect(phase2.error).toContain('content_base64')
  })

  it('should include next steps', async () => {
    const result = await initiateExchangeTool.execute({
      name: 'Test Offer',
      description: 'Test',
      price_wei: '100000000000000000',
    })

    expect(result).toHaveProperty('next_steps')
    expect(Array.isArray(result.next_steps)).toBe(true)
    expect(result.next_steps.length).toBeGreaterThan(0)
  })
})
