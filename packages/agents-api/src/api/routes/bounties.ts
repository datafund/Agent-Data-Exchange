import { Router } from 'express'
import { randomUUID } from 'crypto'
import type { AgentsDatabase } from '../../db/database.js'
import { sanitize, isValidAddress } from '../sanitize.js'
import { verifySignature } from '../middleware/verify-signature.js'
import { strictRateLimit } from '../middleware/rate-limit.js'

// Input validation constants
const MAX_TITLE_LENGTH = 200
const MAX_DESCRIPTION_LENGTH = 5000
const MAX_TAGS = 10
const MIN_EXPIRY_SECONDS = 86400      // 1 day
const MAX_EXPIRY_SECONDS = 365 * 86400 // 365 days

export function bountyRoutes(db: AgentsDatabase): Router {
  const router = Router()

  // Apply rate limiting to all bounty routes
  router.use(strictRateLimit)

  // POST /bounties — create a new bounty (requires signature)
  router.post('/', verifySignature, (req, res) => {
    const verifiedAddress = (req as any).verifiedAddress as string

    // SECURITY: Always use verified signer, ignore req.body.poster
    const poster = verifiedAddress

    const { posterAgentId, title, description, category, rewardAmount, rewardToken, tags, moltbookPostId, expiresIn } = req.body

    // Input validation
    if (!title || typeof title !== 'string') {
      res.status(400).json({ error: 'Title is required' })
      return
    }
    if (title.length > MAX_TITLE_LENGTH) {
      res.status(400).json({ error: `Title must be ${MAX_TITLE_LENGTH} characters or less` })
      return
    }
    if (description && description.length > MAX_DESCRIPTION_LENGTH) {
      res.status(400).json({ error: `Description must be ${MAX_DESCRIPTION_LENGTH} characters or less` })
      return
    }
    if (!rewardAmount || BigInt(rewardAmount) <= 0n) {
      res.status(400).json({ error: 'Reward amount must be greater than 0' })
      return
    }
    if (tags && (!Array.isArray(tags) || tags.length > MAX_TAGS)) {
      res.status(400).json({ error: `Maximum ${MAX_TAGS} tags allowed` })
      return
    }
    if (expiresIn !== undefined) {
      const expiry = Number(expiresIn)
      if (isNaN(expiry) || expiry < MIN_EXPIRY_SECONDS || expiry > MAX_EXPIRY_SECONDS) {
        res.status(400).json({ error: 'Expiry must be between 1 and 365 days (in seconds)' })
        return
      }
    }

    const id = randomUUID()
    const now = Math.floor(Date.now() / 1000)
    const expiresAt = now + (expiresIn ?? 7 * 86400) // default 7 days

    const created = db.createBounty({
      id,
      poster,
      posterAgentId,
      title: sanitize(title),
      description: sanitize(description),
      category: sanitize(category),
      rewardAmount,
      rewardToken,
      tags,
      moltbookPostId,
      createdAt: now,
      expiresAt,
    })

    if (!created) {
      res.status(500).json({ error: 'Failed to create bounty' })
      return
    }

    res.status(201).json({ id, poster: poster.toLowerCase(), title, status: 'open', createdAt: now, expiresAt })
  })

  // GET /bounties — list bounties with filtering
  router.get('/', (req, res) => {
    const { poster, category, status, tags, min_reward, max_reward, sort, limit, offset } = req.query

    // Expire old bounties on each query
    db.expireOldBounties()

    // Use advanced search if any filter params are provided
    const hasAdvancedFilters = tags || min_reward || max_reward || sort

    let bounties
    if (hasAdvancedFilters) {
      bounties = db.searchBounties({
        category: category as string,
        tags: tags ? (tags as string).split(',').map(t => t.trim()) : undefined,
        minReward: min_reward as string,
        maxReward: max_reward as string,
        sort: sort as 'newest' | 'reward' | 'expiring',
        limit: limit ? Number(limit) : 50,
        offset: offset ? Number(offset) : 0,
      })
    } else {
      bounties = db.listBounties({
        poster: poster as string,
        category: category as string,
        status: (status as string) ?? 'open',
        limit: limit ? Number(limit) : 50,
        offset: offset ? Number(offset) : 0,
      })
    }
    const total = db.countBounties({ poster: poster as string, status: (status as string) ?? 'open' })

    // Get fulfillment counts for each bounty
    res.json({
      bounties: bounties.map(b => ({
        ...b,
        tags: JSON.parse(b.tags),
        poster_reputation: undefined, // TODO: Add poster reputation lookup
      })),
      total,
    })
  })

  // GET /bounties/:id — get single bounty
  router.get('/:id', (req, res) => {
    const bounty = db.getBounty(req.params.id)
    if (!bounty) {
      res.status(404).json({ error: 'Bounty not found' })
      return
    }
    res.json({ ...bounty, tags: JSON.parse(bounty.tags) })
  })

  // POST /bounties/:id/fulfill — link bounty to escrow (requires signature + authorization)
  router.post('/:id/fulfill', verifySignature, (req, res) => {
    const verifiedAddress = (req as any).verifiedAddress as string

    const bounty = db.getBounty(req.params.id)
    if (!bounty) {
      res.status(404).json({ error: 'Bounty not found' })
      return
    }
    if (bounty.status !== 'open') {
      res.status(400).json({ error: `Bounty is ${bounty.status}, not open` })
      return
    }

    const { escrowId } = req.body
    if (!escrowId) {
      res.status(400).json({ error: 'escrowId is required' })
      return
    }

    // SECURITY: Only bounty poster or escrow seller can fulfill
    const escrow = db.getEscrow(Number(escrowId))
    if (!escrow) {
      res.status(404).json({ error: 'Escrow not found' })
      return
    }

    const isPoster = bounty.poster.toLowerCase() === verifiedAddress.toLowerCase()
    const isSeller = escrow.seller.toLowerCase() === verifiedAddress.toLowerCase()

    if (!isPoster && !isSeller) {
      res.status(403).json({ error: 'Only bounty poster or escrow seller can fulfill' })
      return
    }

    db.fulfillBounty(req.params.id, escrowId)
    res.json({ id: req.params.id, status: 'fulfilled', escrowId })
  })

  // POST /bounties/:id/cancel — cancel a bounty (requires signature + ownership)
  router.post('/:id/cancel', verifySignature, (req, res) => {
    const verifiedAddress = (req as any).verifiedAddress as string

    const bounty = db.getBounty(req.params.id)
    if (!bounty) {
      res.status(404).json({ error: 'Bounty not found' })
      return
    }

    // SECURITY: Only poster can cancel their own bounty
    if (bounty.poster.toLowerCase() !== verifiedAddress.toLowerCase()) {
      res.status(403).json({ error: 'Only bounty poster can cancel' })
      return
    }

    if (bounty.status !== 'open') {
      res.status(400).json({ error: `Bounty is ${bounty.status}, not open` })
      return
    }

    db.cancelBounty(req.params.id)
    res.json({ id: req.params.id, status: 'cancelled' })
  })

  return router
}
