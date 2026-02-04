import { Router } from 'express'
import { randomUUID } from 'crypto'
import type { AgentsDatabase } from '../../db/database.js'
import { sanitize, isValidAddress } from '../sanitize.js'

export function bountyRoutes(db: AgentsDatabase): Router {
  const router = Router()

  // POST /bounties — create a new bounty
  router.post('/', (req, res) => {
    const { poster, posterAgentId, title, description, category, rewardAmount, rewardToken, tags, moltbookPostId, expiresIn } = req.body

    if (!isValidAddress(poster) || !title) {
      res.status(400).json({ error: 'valid poster address and title are required' })
      return
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

  // POST /bounties/:id/fulfill — link bounty to escrow
  router.post('/:id/fulfill', (req, res) => {
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

    db.fulfillBounty(req.params.id, escrowId)
    res.json({ id: req.params.id, status: 'fulfilled', escrowId })
  })

  // POST /bounties/:id/cancel — cancel a bounty
  router.post('/:id/cancel', (req, res) => {
    const bounty = db.getBounty(req.params.id)
    if (!bounty) {
      res.status(404).json({ error: 'Bounty not found' })
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
