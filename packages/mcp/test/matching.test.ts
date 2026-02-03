import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { matchBountiesTool } from '../src/tools/matching.js'

// Mock fetch for API calls
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('df_match_bounties', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should match knowledge items against bounties', async () => {
    // Mock bounties response
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/bounties')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            bounties: [
              {
                id: 'bounty-1',
                title: 'Need climate research',
                description: 'Looking for climate data',
                category: 'research',
                tags: ['climate', 'environment'],
                reward_amount: '1000000000000000000',
                poster: '0x1234567890123456789012345678901234567890',
              },
              {
                id: 'bounty-2',
                title: 'Need TypeScript code',
                description: 'Looking for utility functions',
                category: 'code',
                tags: ['typescript', 'utils'],
                reward_amount: '500000000000000000',
                poster: '0x2345678901234567890123456789012345678901',
              },
            ],
          }),
        })
      }
      if (url.includes('/market/pricing')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            avg_price: '750000000000000000',
          }),
        })
      }
      return Promise.resolve({ ok: false })
    })

    const knowledgeItems = [
      {
        path: '/docs/climate-analysis.md',
        category: 'research',
        tags: ['climate', 'data'],
        size_bytes: 5000,
      },
    ]

    const result = await matchBountiesTool.execute({
      knowledge_items: knowledgeItems,
    })

    expect(result).toHaveProperty('matches')
    expect(result).toHaveProperty('total_bounties_checked')
    expect(result).toHaveProperty('privacy_note')
    expect(result.total_bounties_checked).toBe(2)
  })

  it('should calculate confidence scores based on category and tag matches', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/bounties')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            bounties: [
              {
                id: 'bounty-1',
                title: 'Climate research needed',
                category: 'research',
                tags: ['climate', 'environment', 'sustainability'],
                reward_amount: '1000000000000000000',
                poster: '0x1234',
              },
            ],
          }),
        })
      }
      if (url.includes('/market/pricing')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ avg_price: null }),
        })
      }
      return Promise.resolve({ ok: false })
    })

    const result = await matchBountiesTool.execute({
      knowledge_items: [
        {
          path: '/research/climate-report.md',
          category: 'research',
          tags: ['climate', 'environment'],
          size_bytes: 10000,
        },
      ],
    })

    // Should have a match with good confidence (category + multiple tags)
    expect(result.matches.length).toBeGreaterThan(0)
    if (result.matches.length > 0) {
      expect(result.matches[0].confidence).toBeGreaterThanOrEqual(50)
      expect(result.matches[0].match_reasons.length).toBeGreaterThan(0)
    }
  })

  it('should filter by minimum confidence threshold', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/bounties')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            bounties: [
              {
                id: 'bounty-1',
                title: 'Need code',
                category: 'code',
                tags: ['javascript'],
                reward_amount: '1000000000000000000',
                poster: '0x1234',
              },
            ],
          }),
        })
      }
      if (url.includes('/market/pricing')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ avg_price: null }),
        })
      }
      return Promise.resolve({ ok: false })
    })

    // This item has no category or tag match, should be below threshold
    const result = await matchBountiesTool.execute({
      knowledge_items: [
        {
          path: '/media/photo.jpg',
          category: 'media',
          tags: ['photography'],
          size_bytes: 100000,
        },
      ],
      min_confidence: 30,
    })

    expect(result.matches.length).toBe(0)
  })

  it('should handle empty bounties gracefully', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/bounties')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ bounties: [] }),
        })
      }
      return Promise.resolve({ ok: false })
    })

    const result = await matchBountiesTool.execute({
      knowledge_items: [
        {
          path: '/docs/report.md',
          category: 'research',
          tags: ['data'],
          size_bytes: 5000,
        },
      ],
    })

    expect(result.matches).toHaveLength(0)
    expect(result.message).toBeDefined()
  })

  it('should handle API errors gracefully', async () => {
    mockFetch.mockImplementation(() => Promise.reject(new Error('Network error')))

    const result = await matchBountiesTool.execute({
      knowledge_items: [
        {
          path: '/docs/report.md',
          category: 'research',
          tags: ['data'],
          size_bytes: 5000,
        },
      ],
    })

    expect(result).toHaveProperty('error')
    expect(result.matches).toHaveLength(0)
  })

  it('should include next steps in response', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/bounties')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            bounties: [
              {
                id: 'bounty-1',
                title: 'Need research',
                category: 'research',
                tags: ['data'],
                reward_amount: '1000000000000000000',
                poster: '0x1234',
              },
            ],
          }),
        })
      }
      if (url.includes('/market/pricing')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ avg_price: '500000000000000000' }),
        })
      }
      return Promise.resolve({ ok: false })
    })

    const result = await matchBountiesTool.execute({
      knowledge_items: [
        {
          path: '/docs/research.md',
          category: 'research',
          tags: ['data'],
          size_bytes: 5000,
        },
      ],
    })

    expect(result).toHaveProperty('next_steps')
    expect(Array.isArray(result.next_steps)).toBe(true)
  })
})
