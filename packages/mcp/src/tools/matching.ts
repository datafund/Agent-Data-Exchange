/**
 * Local bounty matching tools
 *
 * ALL matching runs locally - only tags/categories compared.
 * No knowledge content is ever sent to the API.
 */

const MARKETPLACE_URL = process.env.MARKETPLACE_URL || 'https://agents.datafund.io'

interface KnowledgeItem {
  path: string
  category: string
  tags: string[]
  size_bytes: number
}

interface BountyMatch {
  bounty: {
    id: string
    title: string
    description: string
    category: string
    tags: string[]
    reward: string
    poster: string
  }
  matching_item: KnowledgeItem
  confidence: number
  match_reasons: string[]
  suggested_price_wei: string | null
}

function calculateMatchConfidence(item: KnowledgeItem, bounty: any): { confidence: number; reasons: string[] } {
  let confidence = 0
  const reasons: string[] = []

  // Category match (strongest signal)
  if (item.category === bounty.category) {
    confidence += 40
    reasons.push(`Category match: ${item.category}`)
  }

  // Tag overlap
  const bountyTags = (bounty.tags || []).map((t: string) => t.toLowerCase())
  const itemTags = item.tags.map(t => t.toLowerCase())

  const matchingTags = itemTags.filter(t => bountyTags.includes(t))
  if (matchingTags.length > 0) {
    confidence += Math.min(30, matchingTags.length * 10)
    reasons.push(`Matching tags: ${matchingTags.join(', ')}`)
  }

  // Partial tag matches (substring matching)
  const partialMatches: string[] = []
  for (const itemTag of itemTags) {
    for (const bountyTag of bountyTags) {
      if (itemTag !== bountyTag && (itemTag.includes(bountyTag) || bountyTag.includes(itemTag))) {
        partialMatches.push(`${itemTag}~${bountyTag}`)
      }
    }
  }
  if (partialMatches.length > 0) {
    confidence += Math.min(15, partialMatches.length * 5)
    reasons.push(`Partial tag matches: ${partialMatches.slice(0, 3).join(', ')}`)
  }

  // Size appropriateness (larger content often more valuable)
  if (item.size_bytes > 10000) {
    confidence += 5
    reasons.push('Substantial content size')
  }

  // Cap at 100
  return { confidence: Math.min(100, confidence), reasons }
}

export const matchBountiesTool = {
  name: 'df_match_bounties',
  description: `Match local knowledge items against open bounties. ALL matching runs locally - only tags/categories are compared, no knowledge content is ever sent.

Input: knowledge_items from df_analyze_knowledge output.
Output: ranked matches with confidence scores and suggested prices.`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      knowledge_items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            category: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
            size_bytes: { type: 'number' },
          },
        },
        description: 'Items from df_analyze_knowledge',
      },
      min_confidence: {
        type: 'number',
        description: 'Minimum confidence threshold (0-100, default: 30)',
      },
    },
    required: ['knowledge_items'],
  },
  async execute(args: { knowledge_items: KnowledgeItem[]; min_confidence?: number }) {
    const minConfidence = args.min_confidence ?? 30
    const matches: BountyMatch[] = []

    // Fetch open bounties
    let bounties: any[] = []
    try {
      const response = await fetch(`${MARKETPLACE_URL}/api/v1/bounties?status=open&limit=200`)
      if (response.ok) {
        const data = await response.json()
        bounties = data.bounties || []
      }
    } catch (err) {
      return {
        error: 'Failed to fetch bounties from marketplace',
        matches: [],
      }
    }

    if (bounties.length === 0) {
      return {
        matches: [],
        message: 'No open bounties found on the marketplace.',
        suggestion: 'Consider using df_market_summary to see marketplace activity.',
      }
    }

    // Fetch pricing for categories
    const categories = [...new Set(args.knowledge_items.map(i => i.category))]
    const categoryPricing: Record<string, string | null> = {}

    await Promise.all(categories.map(async (category) => {
      try {
        const response = await fetch(`${MARKETPLACE_URL}/api/v1/market/pricing?category=${category}`)
        if (response.ok) {
          const data = await response.json()
          categoryPricing[category] = data.avg_price || null
        }
      } catch {
        categoryPricing[category] = null
      }
    }))

    // Match each item against bounties locally
    for (const item of args.knowledge_items) {
      for (const bounty of bounties) {
        const { confidence, reasons } = calculateMatchConfidence(item, bounty)

        if (confidence >= minConfidence) {
          matches.push({
            bounty: {
              id: bounty.id,
              title: bounty.title,
              description: bounty.description || '',
              category: bounty.category || '',
              tags: bounty.tags || [],
              reward: bounty.reward_amount || '0',
              poster: bounty.poster,
            },
            matching_item: item,
            confidence,
            match_reasons: reasons,
            suggested_price_wei: categoryPricing[item.category] || bounty.reward_amount || null,
          })
        }
      }
    }

    // Sort by confidence descending
    matches.sort((a, b) => b.confidence - a.confidence)

    // Dedupe: keep only best match per bounty
    const seenBounties = new Set<string>()
    const dedupedMatches = matches.filter(m => {
      if (seenBounties.has(m.bounty.id)) return false
      seenBounties.add(m.bounty.id)
      return true
    })

    return {
      matches: dedupedMatches.slice(0, 20),
      total_bounties_checked: bounties.length,
      total_items_matched: args.knowledge_items.length,
      matches_found: dedupedMatches.length,
      privacy_note: 'All matching performed locally. Only metadata (tags, categories) was compared.',
      next_steps: dedupedMatches.length > 0
        ? [
            'Review high-confidence matches',
            'Use df_sell to fulfill bounties you can satisfy',
            'Use df_check_reputation to verify bounty posters',
          ]
        : [
            'No strong matches found',
            'Use df_browse_skills to see what sells well',
            'Use df_post_bounty to request data you need',
          ],
    }
  },
}
