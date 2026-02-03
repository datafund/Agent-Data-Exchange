/**
 * Network growth tools
 *
 * Tools to help agents share capabilities and initiate exchanges with peers.
 */

import { randomUUID } from 'crypto'
import { session } from '../session.js'

const MARKETPLACE_URL = process.env.MARKETPLACE_URL || 'https://agents.datafund.io'

// In-memory offer storage (expires after 24h)
const pendingOffers = new Map<string, {
  name: string
  description: string
  price_wei: string
  category?: string
  tags?: string[]
  createdAt: number
}>()

// Clean up expired offers
function cleanExpiredOffers() {
  const now = Date.now()
  const maxAge = 24 * 60 * 60 * 1000 // 24 hours
  for (const [id, offer] of pendingOffers) {
    if (now - offer.createdAt > maxAge) {
      pendingOffers.delete(id)
    }
  }
}

export const generateCardTool = {
  name: 'df_generate_card',
  description: `Generate a structured capability card to share with other agents. JSON-parseable format includes your identity, categories you trade in, and install instructions.

Use this to introduce yourself to potential trading partners.`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      categories: {
        type: 'array',
        items: { type: 'string' },
        description: 'Categories you can provide (research, code, dataset, media)',
      },
      seeking: {
        type: 'array',
        items: { type: 'string' },
        description: 'Categories you are looking to buy',
      },
      custom_message: {
        type: 'string',
        description: 'Optional custom introduction message',
      },
    },
    required: [],
  },
  async execute(args: { categories?: string[]; seeking?: string[]; custom_message?: string }) {
    const address = session.address
    const subdomain = session.subdomain

    // Fetch reputation if we have an address
    let reputation = null
    if (address) {
      try {
        const response = await fetch(`${MARKETPLACE_URL}/api/v1/wallets/${address}/reputation`)
        if (response.ok) {
          reputation = await response.json()
        }
      } catch {
        // Continue without reputation
      }
    }

    // Fetch sample offerings if we have an address
    let sampleOfferings: any[] = []
    if (address) {
      try {
        const response = await fetch(`${MARKETPLACE_URL}/api/v1/skills?seller=${address}&limit=5`)
        if (response.ok) {
          const data = await response.json()
          sampleOfferings = (data.skills || []).map((s: any) => ({
            title: s.title,
            category: s.category,
            price: s.price,
          }))
        }
      } catch {
        // Continue without offerings
      }
    }

    const card = {
      type: 'datafund_agent_card',
      version: '1.0',
      identity: {
        address: address || 'not_connected',
        ens: subdomain ? `${subdomain}.fds.eth` : null,
        reputation: reputation ? {
          score: reputation.seller?.reputation_score || reputation.buyer?.reputation_score || 0,
          tier: reputation.tier || 'new',
          total_trades: (reputation.seller?.total_completed || 0) + (reputation.buyer?.total_completed || 0),
        } : null,
      },
      capabilities: {
        categories: args.categories || [],
        sample_offerings: sampleOfferings,
        seeking: args.seeking || [],
      },
      message: args.custom_message || null,
      exchange_protocol: {
        escrow_contract: '0xDd4396d4F28d2b513175ae17dE11e56a898d19c3',
        chain: 'Base (8453)',
        mcp_install: 'npx @datafund/agent-data-exchange',
        marketplace: MARKETPLACE_URL,
      },
      generated_at: new Date().toISOString(),
    }

    // Generate shareable text version
    const shareText = `
**Datafund Agent Card**
${address ? `Address: ${address.slice(0, 10)}...${address.slice(-8)}` : 'Not connected'}
${subdomain ? `ENS: ${subdomain}.fds.eth` : ''}
${reputation ? `Reputation: ${reputation.tier || 'new'} (${card.identity.reputation?.total_trades || 0} trades)` : ''}

**I can provide:** ${(args.categories || []).join(', ') || 'Not specified'}
**I'm looking for:** ${(args.seeking || []).join(', ') || 'Not specified'}

${args.custom_message || ''}

**To trade with me:**
1. Install: \`npx @datafund/agent-data-exchange\`
2. Browse my listings: ${MARKETPLACE_URL}/skills?seller=${address || ''}
3. Or contact via encrypted message: Use df_send_anonymous
`.trim()

    return {
      card,
      share_text: shareText,
      usage: 'Share the card JSON with other agents, or use share_text for human-readable format.',
    }
  },
}

export const initiateExchangeTool = {
  name: 'df_initiate_exchange',
  description: `Two-phase exchange initiation:

Phase 1 (offer_only): Create a free offer (no gas, no escrow). Returns offer_id and shareable message.
Phase 2 (provide offer_id + content): Create escrow and prepare content for sale.

This allows negotiation before committing funds on-chain.`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      // Phase 1 params
      name: {
        type: 'string',
        description: 'Name/title of what you are offering',
      },
      description: {
        type: 'string',
        description: 'Description of the offering',
      },
      price_wei: {
        type: 'string',
        description: 'Price in wei',
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
      // Phase 2 params
      offer_id: {
        type: 'string',
        description: 'Offer ID from phase 1 (triggers phase 2)',
      },
      content_base64: {
        type: 'string',
        description: 'Base64-encoded content to sell (phase 2 only)',
      },
    },
    required: [],
  },
  async execute(args: {
    name?: string
    description?: string
    price_wei?: string
    category?: string
    tags?: string[]
    offer_id?: string
    content_base64?: string
  }) {
    cleanExpiredOffers()

    // Phase 2: Create escrow for existing offer
    if (args.offer_id) {
      const offer = pendingOffers.get(args.offer_id)
      if (!offer) {
        return {
          error: 'Offer not found or expired (offers expire after 24 hours)',
          suggestion: 'Create a new offer without offer_id',
        }
      }

      if (!args.content_base64) {
        return {
          error: 'content_base64 is required for phase 2',
          offer_details: offer,
        }
      }

      // At this point, the agent should use df_sell to complete the sale
      // We return instructions rather than duplicating df_sell logic
      pendingOffers.delete(args.offer_id)

      return {
        phase: 2,
        status: 'ready_to_sell',
        offer_details: offer,
        next_step: `Use df_sell to create the escrow and upload content:

df_sell({
  content_base64: "${args.content_base64.slice(0, 20)}...",
  name: "${offer.name}",
  description: "${offer.description}",
  price_wei: "${offer.price_wei}",
  category: "${offer.category || 'other'}",
  tags: ${JSON.stringify(offer.tags || [])}
})`,
        share_message: `Escrow ready! Once created, share the skill listing URL with your trading partner.`,
      }
    }

    // Phase 1: Create offer (no escrow yet)
    if (!args.name || !args.description || !args.price_wei) {
      return {
        error: 'Phase 1 requires name, description, and price_wei',
        usage: 'Create an offer first, then use the offer_id with content to finalize',
      }
    }

    const offerId = randomUUID()
    const address = session.address

    pendingOffers.set(offerId, {
      name: args.name,
      description: args.description,
      price_wei: args.price_wei,
      category: args.category,
      tags: args.tags,
      createdAt: Date.now(),
    })

    // Format price for display
    const priceEth = (BigInt(args.price_wei) / BigInt(1e18)).toString()
    const priceGwei = (BigInt(args.price_wei) / BigInt(1e9)).toString()

    const shareMessage = `
**Offer: ${args.name}**

${args.description}

**Price:** ${priceEth} ETH (${args.price_wei} wei)
${args.category ? `**Category:** ${args.category}` : ''}
${args.tags?.length ? `**Tags:** ${args.tags.join(', ')}` : ''}

**Seller:** ${address || 'anonymous'}
**Expires:** 24 hours

To accept this offer, the seller will create an escrow. Reply to confirm interest.
`.trim()

    return {
      phase: 1,
      status: 'offer_created',
      offer_id: offerId,
      offer_details: {
        name: args.name,
        description: args.description,
        price_wei: args.price_wei,
        price_eth: priceEth,
        category: args.category,
        tags: args.tags,
        expires_in: '24 hours',
      },
      share_message: shareMessage,
      next_steps: [
        'Share the offer message with potential buyers',
        'When a buyer accepts, call this tool again with offer_id and content_base64',
        'The escrow will be created on-chain only after buyer confirms interest',
      ],
    }
  },
}
