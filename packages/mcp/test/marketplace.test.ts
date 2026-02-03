import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  searchBountiesTool,
  postBountyTool,
  watchCategoryTool,
  suggestPriceTool,
  marketSummaryTool,
} from '../src/tools/marketplace.js'

// Mock fetch for API calls
const mockFetch = vi.fn()
global.fetch = mockFetch

// Mock session for postBountyTool
vi.mock('../src/session.js', () => ({
  session: {
    address: '0x1234567890123456789012345678901234567890',
    subdomain: 'testagent',
    requireAddress: () => '0x1234567890123456789012345678901234567890',
  },
}))

describe('df_search_bounties', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should search bounties with filters', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        bounties: [
          {
            id: 'bounty-1',
            title: 'Need climate research',
            category: 'research',
            tags: ['climate'],
            reward_amount: '1000000000000000000',
          },
        ],
        total: 1,
      }),
    })

    const result = await searchBountiesTool.execute({
      category: 'research',
      tags: ['climate'],
      sort: 'reward',
    })

    expect(result).toHaveProperty('bounties')
    expect(result).toHaveProperty('total')
    expect(result).toHaveProperty('filters_applied')
    expect(result.filters_applied.category).toBe('research')
  })

  it('should include next steps in response', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ bounties: [], total: 0 }),
    })

    const result = await searchBountiesTool.execute({})

    expect(result).toHaveProperty('next_steps')
    expect(Array.isArray(result.next_steps)).toBe(true)
  })

  it('should handle API errors', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      statusText: 'Server Error',
    })

    await expect(searchBountiesTool.execute({})).rejects.toThrow('Bounty search failed')
  })
})

describe('df_post_bounty', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('should post a bounty', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        id: 'new-bounty-id',
        status: 'open',
      }),
    })

    const result = await postBountyTool.execute({
      title: 'Need AI research data',
      description: 'Looking for comprehensive AI datasets',
      reward_amount: '2000000000000000000',
      category: 'dataset',
      tags: ['ai', 'ml'],
    })

    expect(result).toHaveProperty('id')
    expect(result).toHaveProperty('share_url')
    expect(result).toHaveProperty('next_steps')
  })

  it('should handle API errors', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      text: () => Promise.resolve('Rate limit exceeded'),
    })

    await expect(
      postBountyTool.execute({
        title: 'Test',
        description: 'Test',
        reward_amount: '100000000000000000',
      })
    ).rejects.toThrow('Failed to post bounty')
  })
})

describe('df_watch_category', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('should fetch category activity', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        new_listings: [{ id: '1', title: 'New listing' }],
        new_bounties: [{ id: '2', title: 'New bounty' }],
        recent_sales: [],
        since: '2024-01-01T00:00:00Z',
      }),
    })

    const result = await watchCategoryTool.execute({
      categories: ['research', 'code'],
    })

    expect(result).toHaveProperty('new_listings')
    expect(result).toHaveProperty('new_bounties')
  })

  it('should handle since parameter', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        new_listings: [],
        new_bounties: [],
        recent_sales: [],
      }),
    })

    const result = await watchCategoryTool.execute({
      since: '2024-06-01T00:00:00Z',
    })

    expect(result).toBeDefined()
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('since=')
    )
  })
})

describe('df_suggest_price', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('should return price suggestion', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        category: 'research',
        min_price: '100000000000000000',
        max_price: '5000000000000000000',
        avg_price: '1000000000000000000',
        median_price: '800000000000000000',
        sample_size: 15,
        insufficient_data: false,
        demand_score: 7,
      }),
    })

    const result = await suggestPriceTool.execute({
      category: 'research',
    })

    expect(result).toHaveProperty('avg_price')
    expect(result).toHaveProperty('demand_score')
    expect(result).toHaveProperty('recommendation')
    expect(result.insufficient_data).toBe(false)
  })

  it('should handle insufficient data', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        category: 'rare-category',
        sample_size: 2,
        insufficient_data: true,
        demand_score: 0,
      }),
    })

    const result = await suggestPriceTool.execute({
      category: 'rare-category',
    })

    expect(result.insufficient_data).toBe(true)
    expect(result.recommendation).toContain('competitive')
  })

  it('should adjust recommendation based on demand score', async () => {
    // High demand
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        category: 'hot-category',
        sample_size: 20,
        insufficient_data: false,
        demand_score: 8,
      }),
    })

    const highDemand = await suggestPriceTool.execute({ category: 'hot-category' })
    expect(highDemand.recommendation).toContain('above average')

    // Low demand
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        category: 'cold-category',
        sample_size: 20,
        insufficient_data: false,
        demand_score: 2,
      }),
    })

    const lowDemand = await suggestPriceTool.execute({ category: 'cold-category' })
    expect(lowDemand.recommendation).toContain('competitive')
  })

  it('should add size notes for large content', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        category: 'dataset',
        sample_size: 10,
        insufficient_data: false,
        demand_score: 5,
      }),
    })

    const result = await suggestPriceTool.execute({
      category: 'dataset',
      content_size_bytes: 5000000, // 5MB
    })

    expect(result.size_note).toContain('Large')
  })
})

describe('df_market_summary', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('should return market summary', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        total_escrows: 150,
        active_listings: 45,
        open_bounties: 20,
        total_volume: '100000000000000000000',
        volume_period: '10000000000000000000',
        total_completed: 100,
        is_early_network: false,
        top_categories: [
          { category: 'research', escrow_count: 50, volume: '50000000000000000000' },
        ],
        trending_categories: ['research', 'code'],
        underserved_categories: [
          { category: 'media', bounty_count: 10, listing_count: 2 },
        ],
      }),
    })

    const result = await marketSummaryTool.execute({ timeframe: '7d' })

    expect(result).toHaveProperty('total_escrows')
    expect(result).toHaveProperty('active_listings')
    expect(result).toHaveProperty('open_bounties')
    expect(result).toHaveProperty('opportunities')
    expect(result).toHaveProperty('suggested_actions')
  })

  it('should identify opportunities from underserved categories', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        total_escrows: 50,
        is_early_network: false,
        underserved_categories: [
          { category: 'media', bounty_count: 10, listing_count: 2 },
        ],
        trending_categories: [],
      }),
    })

    const result = await marketSummaryTool.execute({})

    expect(result.opportunities.some((o: string) => o.includes('Underserved'))).toBe(true)
  })

  it('should note early network status', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        total_escrows: 25,
        is_early_network: true,
        underserved_categories: [],
        trending_categories: [],
        message: 'Early network - great opportunity!',
      }),
    })

    const result = await marketSummaryTool.execute({})

    expect(result.opportunities.some((o: string) => o.includes('Early'))).toBe(true)
  })

  it('should filter null suggested actions', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        total_escrows: 100,
        open_bounties: 0, // No bounties
        is_early_network: false,
        underserved_categories: [],
        trending_categories: [],
      }),
    })

    const result = await marketSummaryTool.execute({})

    // Should not include bounty-related action when there are no bounties
    expect(result.suggested_actions.every((a: string) => a !== null)).toBe(true)
  })
})
