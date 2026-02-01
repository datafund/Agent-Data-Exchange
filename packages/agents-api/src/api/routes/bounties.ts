import { Router } from 'express'
import { randomUUID } from 'crypto'
import type { AgentsDatabase } from '../../db/database.js'
import { verifySignature } from '../middleware/verify-signature.js'

export function bountyRoutes(db: AgentsDatabase): Router {
  const router = Router()

  // POST /bounties — create a new bounty (requires signature)
  router.post('/', verifySignature, (req, res) => {
    const verifiedAddress = (req as any).verifiedAddress as string
    const { posterAgentId, title, description, category, rewardAmount, rewardToken, tags, moltbookPostId, expiresIn } = req.body

    if (!title || typeof title !== 'string') {
      res.status(400).json({ error: 'title is required' })
      return
    }
    if (title.length > 500) {
      res.status(400).json({ error: 'title must be 500 characters or less' })
      return
    }
    if (description && typeof description === 'string' && description.length > 5000) {
      res.status(400).json({ error: 'description must be 5000 characters or less' })
      return
    }
    if (tags && Array.isArray(tags) && tags.length > 20) {
      res.status(400).json({ error: 'Maximum 20 tags allowed' })
      return
    }

    // Validate expiresIn: 1 hour to 90 days
    const parsedExpiresIn = expiresIn != null ? Number(expiresIn) : 7 * 86400
    if (isNaN(parsedExpiresIn) || parsedExpiresIn < 3600 || parsedExpiresIn > 90 * 86400) {
      res.status(400).json({ error: 'expiresIn must be between 3600 (1 hour) and 7776000 (90 days) seconds' })
      return
    }

    // Poster is always the verified signer — cannot be spoofed
    const poster = verifiedAddress

    const id = randomUUID()
    const now = Math.floor(Date.now() / 1000)
    const expiresAt = now + parsedExpiresIn

    const created = db.createBounty({
      id,
      poster,
      posterAgentId,
      title,
      description,
      category,
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

    res.status(201).json({ id, poster, title, status: 'open', createdAt: now, expiresAt })
  })

  // GET /bounties — list bounties
  router.get('/', (req, res) => {
    const { poster, category, status, limit, offset } = req.query

    // Expire old bounties on each query
    db.expireOldBounties()

    const bounties = db.listBounties({
      poster: poster as string,
      category: category as string,
      status: (status as string) ?? 'open',
      limit: Math.min(limit ? Number(limit) : 50, 100),
      offset: Math.max(offset ? Number(offset) : 0, 0),
    })
    const total = db.countBounties({ poster: poster as string, status: (status as string) ?? 'open' })

    res.json({
      bounties: bounties.map(b => ({
        ...b,
        tags: JSON.parse(b.tags),
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

  // POST /bounties/:id/fulfill — link bounty to escrow (requires signature)
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

    // Verify the escrow exists and the fulfiller is the seller
    const escrow = db.getEscrow(Number(escrowId))
    if (!escrow) {
      res.status(400).json({ error: 'Escrow not found' })
      return
    }
    if (escrow.seller.toLowerCase() !== verifiedAddress) {
      res.status(403).json({ error: 'Only the escrow seller can fulfill a bounty' })
      return
    }
    if (!escrow.completed) {
      res.status(400).json({ error: 'Escrow must be completed before fulfilling a bounty' })
      return
    }

    db.fulfillBounty(req.params.id, escrowId)
    res.json({ id: req.params.id, status: 'fulfilled', escrowId })
  })

  // POST /bounties/:id/cancel — cancel a bounty (requires signature, must be poster)
  router.post('/:id/cancel', verifySignature, (req, res) => {
    const verifiedAddress = (req as any).verifiedAddress as string
    const bounty = db.getBounty(req.params.id)
    if (!bounty) {
      res.status(404).json({ error: 'Bounty not found' })
      return
    }
    if (bounty.poster !== verifiedAddress) {
      res.status(403).json({ error: 'Only the bounty poster can cancel' })
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
