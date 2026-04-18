const MARKETPLACE_URL = process.env.MARKETPLACE_URL || 'https://agents.datafund.io'

export const browseSkillsTool = {
  name: 'df_browse_skills',
  description: 'Browse skills listed on the Datafund marketplace.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      category: {
        type: 'string',
        description: 'Filter by category: research, media, dataset, code, other',
      },
      query: {
        type: 'string',
        description: 'Search query',
      },
      limit: {
        type: 'number',
        description: 'Max results (default: 20)',
      },
      offset: {
        type: 'number',
        description: 'Pagination offset',
      },
    },
    required: [] as string[],
  },
  async execute(args: { category?: string; query?: string; limit?: number; offset?: number }) {
    const params = new URLSearchParams()
    if (args.category) params.set('category', args.category)
    if (args.query) params.set('q', args.query)
    if (args.limit) params.set('limit', String(args.limit))
    if (args.offset) params.set('offset', String(args.offset))

    const response = await fetch(`${MARKETPLACE_URL}/api/v1/skills?${params}`)
    if (!response.ok) throw new Error(`Marketplace error: ${response.statusText}`)

    return await response.json()
  },
}

export const publishSkillTool = {
  name: 'df_publish_skill',
  description: 'Publish a skill listing on the marketplace (after escrow creation). Requires active session with private key for signing.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      title: { type: 'string', description: 'Skill title' },
      description: { type: 'string', description: 'Skill description' },
      category: { type: 'string', description: 'Category: research, media, dataset, code, other' },
      price_wei: { type: 'string', description: 'Price in wei' },
      escrow_id: { type: 'string', description: 'On-chain escrow ID' },
      seller_address: { type: 'string', description: 'Seller Ethereum address' },
      content_hash: { type: 'string', description: 'Content hash from escrow' },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Tags for discovery',
      },
      product_type: { type: 'string', description: 'Data product type (e.g. "engram-pack")' },
      metadata: {
        type: 'object',
        description: 'Product type-specific metadata (validated against type schema)',
      },
    },
    required: ['title', 'description', 'category', 'price_wei', 'escrow_id', 'seller_address', 'content_hash'],
  },
  async execute(args: {
    title: string
    description: string
    category: string
    price_wei: string
    escrow_id: string
    seller_address: string
    content_hash: string
    tags?: string[]
    product_type?: string
    metadata?: Record<string, unknown>
  }) {
    const { session } = await import('../session.js')
    const { signRequest } = await import('../signing.js')
    const privateKey = session.requirePrivateKey()

    const body: Record<string, unknown> = {
      seller: args.seller_address,
      title: args.title,
      description: args.description,
      category: args.category,
      price: args.price_wei,
      priceToken: 'ETH',
      escrowId: parseInt(args.escrow_id, 10),
      contentHash: args.content_hash,
      tags: args.tags || [],
    }
    if (args.product_type) body.product_type = args.product_type
    if (args.metadata) body.metadata = args.metadata

    const headers = signRequest(body, privateKey)
    const response = await fetch(`${MARKETPLACE_URL}/api/v1/skills`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const err = await response.text()
      throw new Error(`Publish failed (${response.status}): ${err}`)
    }

    return await response.json()
  },
}

export const checkReputationTool = {
  name: 'df_check_reputation',
  description: 'Check seller reputation on the marketplace. Returns proceed/caution/avoid recommendation.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      address: {
        type: 'string',
        description: 'Ethereum address to check',
      },
    },
    required: ['address'],
  },
  async execute(args: { address: string }) {
    const response = await fetch(`${MARKETPLACE_URL}/api/v1/wallets/${args.address}/reputation`)
    if (!response.ok) throw new Error(`Reputation check failed: ${response.statusText}`)

    return await response.json()
  },
}

export const skillDetailsTool = {
  name: 'df_skill_details',
  description: 'Get detailed purchase info for a specific skill listing.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      skill_id: {
        type: 'string',
        description: 'Skill ID from marketplace',
      },
    },
    required: ['skill_id'],
  },
  async execute(args: { skill_id: string }) {
    const response = await fetch(`${MARKETPLACE_URL}/api/v1/skills/${args.skill_id}/purchase-info`)
    if (!response.ok) throw new Error(`Skill details failed: ${response.statusText}`)

    return await response.json()
  },
}

// === Phase 2: Growth & Facilitation Tools ===

export const searchBountiesTool = {
  name: 'df_search_bounties',
  description: `Search open bounties with filters. Find data requests you can fulfill.

Includes poster reputation and whether reward is escrowed (trust signals).`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      category: {
        type: 'string',
        description: 'Filter by category: research, code, dataset, media, other',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Filter by tags (matches any)',
      },
      min_reward: {
        type: 'string',
        description: 'Minimum reward in wei',
      },
      max_reward: {
        type: 'string',
        description: 'Maximum reward in wei',
      },
      sort: {
        type: 'string',
        enum: ['newest', 'reward', 'expiring'],
        description: 'Sort order (default: newest)',
      },
      limit: {
        type: 'number',
        description: 'Max results (default: 20)',
      },
    },
    required: [],
  },
  async execute(args: {
    category?: string
    tags?: string[]
    min_reward?: string
    max_reward?: string
    sort?: 'newest' | 'reward' | 'expiring'
    limit?: number
  }) {
    const params = new URLSearchParams()
    params.set('status', 'open')
    if (args.category) params.set('category', args.category)
    if (args.tags?.length) params.set('tags', args.tags.join(','))
    if (args.min_reward) params.set('min_reward', args.min_reward)
    if (args.max_reward) params.set('max_reward', args.max_reward)
    if (args.sort) params.set('sort', args.sort)
    if (args.limit) params.set('limit', String(args.limit))

    const response = await fetch(`${MARKETPLACE_URL}/api/v1/bounties?${params}`)
    if (!response.ok) throw new Error(`Bounty search failed: ${response.statusText}`)

    const data = await response.json()

    return {
      bounties: data.bounties,
      total: data.total,
      filters_applied: {
        category: args.category,
        tags: args.tags,
        min_reward: args.min_reward,
        max_reward: args.max_reward,
        sort: args.sort || 'newest',
      },
      next_steps: data.bounties.length > 0
        ? ['Use df_match_bounties to find local knowledge that matches', 'Use df_check_reputation to verify poster trustworthiness']
        : ['No bounties found with these filters. Try df_market_summary for overview.'],
    }
  },
}

export const postBountyTool = {
  name: 'df_post_bounty',
  description: `Post a request for specific data. Rate limited to 5/day per address.

Note: For trust, consider creating an escrow first and linking it to the bounty.`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      title: {
        type: 'string',
        description: 'Bounty title (what you need)',
      },
      description: {
        type: 'string',
        description: 'Detailed description of requirements',
      },
      category: {
        type: 'string',
        description: 'Category: research, code, dataset, media, other',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Tags for discovery',
      },
      reward_amount: {
        type: 'string',
        description: 'Reward amount in wei',
      },
      reward_token: {
        type: 'string',
        description: 'Token address (default: ETH = 0x0...)',
      },
      expires_days: {
        type: 'number',
        description: 'Days until expiry (default: 7)',
      },
    },
    required: ['title', 'description', 'reward_amount'],
  },
  async execute(args: {
    title: string
    description: string
    category?: string
    tags?: string[]
    reward_amount: string
    reward_token?: string
    expires_days?: number
  }) {
    // Import session to get address
    const { session } = await import('../session.js')
    const poster = session.requireAddress()

    const response = await fetch(`${MARKETPLACE_URL}/api/v1/bounties`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        poster,
        title: args.title,
        description: args.description,
        category: args.category || 'other',
        tags: args.tags || [],
        rewardAmount: args.reward_amount,
        rewardToken: args.reward_token || '0x0000000000000000000000000000000000000000',
        expiresIn: (args.expires_days || 7) * 86400,
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      throw new Error(`Failed to post bounty: ${err}`)
    }

    const result = await response.json()

    return {
      ...result,
      share_url: `${MARKETPLACE_URL}/bounty/${result.id}`,
      next_steps: [
        'Share your bounty to attract sellers',
        'Monitor responses with df_search_bounties',
        'When fulfilled, use df_buy to purchase the data',
      ],
    }
  },
}

export const watchCategoryTool = {
  name: 'df_watch_category',
  description: `Get recent activity in categories: new listings, bounties, price movements.

Useful for monitoring market trends and opportunities.`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      categories: {
        type: 'array',
        items: { type: 'string' },
        description: 'Categories to watch (empty for all)',
      },
      since: {
        type: 'string',
        description: 'ISO8601 timestamp (default: last 24 hours)',
      },
    },
    required: [],
  },
  async execute(args: { categories?: string[]; since?: string }) {
    const params = new URLSearchParams()
    if (args.categories?.length) params.set('categories', args.categories.join(','))
    if (args.since) params.set('since', args.since)

    const response = await fetch(`${MARKETPLACE_URL}/api/v1/market/activity?${params}`)
    if (!response.ok) throw new Error(`Activity fetch failed: ${response.statusText}`)

    return await response.json()
  },
}

export const suggestPriceTool = {
  name: 'df_suggest_price',
  description: `Get price recommendation based on marketplace comparables.

Returns suggested price, price range, and demand score. Indicates when data is insufficient.`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      category: {
        type: 'string',
        description: 'Category: research, code, dataset, media, other',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional tags for more precise matching',
      },
      content_size_bytes: {
        type: 'number',
        description: 'Size of content (optional, for context)',
      },
    },
    required: ['category'],
  },
  async execute(args: { category: string; tags?: string[]; content_size_bytes?: number }) {
    const params = new URLSearchParams()
    params.set('category', args.category)
    if (args.tags?.length) params.set('tags', args.tags.join(','))

    const response = await fetch(`${MARKETPLACE_URL}/api/v1/market/pricing?${params}`)
    if (!response.ok) throw new Error(`Pricing fetch failed: ${response.statusText}`)

    const data = await response.json()

    // Add size-based adjustment suggestion
    let sizeNote = null
    if (args.content_size_bytes) {
      if (args.content_size_bytes > 1_000_000) {
        sizeNote = 'Large content size may justify higher pricing'
      } else if (args.content_size_bytes < 1000) {
        sizeNote = 'Small content size - consider bundling or competitive pricing'
      }
    }

    return {
      ...data,
      size_note: sizeNote,
      recommendation: data.insufficient_data
        ? 'Limited market data. Start competitive to build reputation.'
        : data.demand_score >= 7
          ? 'High demand - you can price above average'
          : data.demand_score <= 3
            ? 'Low demand - competitive pricing recommended'
            : 'Normal demand - price around the median',
    }
  },
}

export const marketSummaryTool = {
  name: 'df_market_summary',
  description: `Get marketplace overview with actionable insights.

Returns: total escrows, active listings, open bounties, volume, trending categories, underserved categories (opportunity signals).`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      timeframe: {
        type: 'string',
        enum: ['24h', '7d', '30d'],
        description: 'Timeframe for metrics (default: 7d)',
      },
    },
    required: [],
  },
  async execute(args: { timeframe?: '24h' | '7d' | '30d' }) {
    const params = new URLSearchParams()
    if (args.timeframe) params.set('timeframe', args.timeframe)

    const response = await fetch(`${MARKETPLACE_URL}/api/v1/market/summary?${params}`)
    if (!response.ok) throw new Error(`Summary fetch failed: ${response.statusText}`)

    const data = await response.json()

    // Add opportunity analysis
    const opportunities = []
    if (data.underserved_categories?.length > 0) {
      opportunities.push(`Underserved categories: ${data.underserved_categories.map((c: any) => c.category).join(', ')}`)
    }
    if (data.trending_categories?.length > 0) {
      opportunities.push(`Trending categories: ${data.trending_categories.join(', ')}`)
    }
    if (data.is_early_network) {
      opportunities.push('Early network - great opportunity to establish reputation!')
    }

    return {
      ...data,
      opportunities,
      suggested_actions: [
        data.open_bounties > 0 ? 'Check open bounties with df_search_bounties' : null,
        data.underserved_categories?.length > 0 ? 'Consider selling in underserved categories' : null,
        'Use df_analyze_knowledge to find sellable content',
        'Use df_generate_card to share your capabilities',
      ].filter(Boolean),
    }
  },
}
