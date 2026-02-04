import { Router } from 'express'
import { randomUUID } from 'crypto'
import type { AgentsDatabase } from '../../db/database.js'
import { sanitize, isValidAddress, verifyWalletSignature } from '../sanitize.js'
import { scoreTier, scoreRecommendation } from '../../reputation/calculator.js'

const ESCROW_CONTRACT = '0xDd4396d4F28d2b513175ae17dE11e56a898d19c3'
const CHAIN_ID = 8453

export function skillRoutes(db: AgentsDatabase): Router {
  const router = Router()

  // POST /skills — list a skill for sale
  router.post('/', (req, res) => {
    const { seller, sellerAgentId, title, description, longDescription, category, price, priceToken, tags, delivery, contentHash, encryptedDataRef, escrowId } = req.body

    if (!isValidAddress(seller) || !title) {
      res.status(400).json({ error: 'valid seller address and title are required' })
      return
    }

    const id = randomUUID()
    const now = Math.floor(Date.now() / 1000)

    const created = db.createSkill({
      id, seller, sellerAgentId, title: sanitize(title), description: sanitize(description), longDescription: sanitize(longDescription),
      category: sanitize(category), price, priceToken, tags, delivery: sanitize(delivery), contentHash, encryptedDataRef, createdAt: now,
    })

    if (!created) {
      res.status(500).json({ error: 'Failed to create skill' })
      return
    }

    // Link to escrow if provided
    if (escrowId != null) {
      try {
        db.linkSkillToEscrow(id, Number(escrowId))
      } catch (err) {
        console.warn(`[skills] Failed to link skill ${id} to escrow ${escrowId}:`, err)
      }
    }

    res.status(201).json({ id, seller: seller.toLowerCase(), title, status: 'active', escrowId: escrowId ?? null, createdAt: now })
  })

  // GET /skills — list skills
  router.get('/', (req, res) => {
    const { seller, category, status, limit, offset } = req.query

    const skills = db.listSkills({
      seller: seller as string,
      category: category as string,
      status: (status as string) ?? 'active',
      limit: limit ? Number(limit) : 50,
      offset: offset ? Number(offset) : 0,
    })
    const total = db.countSkills({ seller: seller as string, category: category as string, status: (status as string) ?? 'active' })

    res.json({
      skills: skills.map(s => ({
        ...s,
        tags: JSON.parse(s.tags),
      })),
      total,
    })
  })

  // GET /skills/:id — get single skill with votes
  router.get('/:id', (req, res) => {
    const skill = db.getSkill(req.params.id)
    if (!skill) {
      res.status(404).json({ error: 'Skill not found' })
      return
    }
    const votes = db.getVoteSummary('skill', req.params.id)
    const commentCount = db.countComments('skill', req.params.id)
    res.json({ ...skill, tags: JSON.parse(skill.tags), votes, commentCount })
  })

  // POST /skills/:id/vote — vote on a skill
  router.post('/:id/vote', async (req, res) => {
    const { voter, voterAgentId, value, signature } = req.body
    if (!isValidAddress(voter) || (value !== 1 && value !== -1)) {
      res.status(400).json({ error: 'valid voter address and value (+1 or -1) required' })
      return
    }
    if (!await verifyWalletSignature(voter, signature, `vote:${req.params.id}:${value}`)) {
      res.status(401).json({ error: 'Invalid signature' })
      return
    }
    db.upsertVote({ voter, voterAgentId, targetType: 'skill', targetId: req.params.id, value })
    const votes = db.getVoteSummary('skill', req.params.id)
    res.json(votes)
  })

  // GET /skills/:id/comments — list comments
  router.get('/:id/comments', (req, res) => {
    const { limit, offset } = req.query
    const comments = db.listComments('skill', req.params.id, limit ? Number(limit) : 50, offset ? Number(offset) : 0)
    const total = db.countComments('skill', req.params.id)
    res.json({ comments, total })
  })

  // POST /skills/:id/comments — add comment
  router.post('/:id/comments', async (req, res) => {
    const { author, authorAgentId, body, signature } = req.body
    if (!isValidAddress(author) || !body) {
      res.status(400).json({ error: 'valid author address and body required' })
      return
    }
    if (!await verifyWalletSignature(author, signature, `comment:${req.params.id}:${body}`)) {
      res.status(401).json({ error: 'Invalid signature' })
      return
    }
    const result = db.addComment({ author, authorAgentId, targetType: 'skill', targetId: req.params.id, body: sanitize(body) })
    res.status(201).json(result)
  })

  // GET /skills/:id/purchase-info — everything an agent needs to fund
  router.get('/:id/purchase-info', (req, res) => {
    const skill = db.getSkill(req.params.id)
    if (!skill) {
      res.status(404).json({ error: 'Skill not found' })
      return
    }

    // Find the next available escrow for this skill (multi-copy support)
    const escrow = db.getAvailableEscrowForSkill(req.params.id)

    if (escrow) {
      // Get seller reputation
      const walletRep = db.getWalletReputation(skill.seller)
      const sellerRep = walletRep.seller
      const totalEscrows = sellerRep ? sellerRep.total_created + sellerRep.total_funded : 0
      const sellerReputation = sellerRep ? {
        score: sellerRep.reputation_score,
        tier: scoreTier(sellerRep.reputation_score, totalEscrows),
        recommendation: scoreRecommendation(sellerRep.reputation_score, totalEscrows),
      } : { score: 0, tier: 'new', recommendation: 'caution' }

      const available = db.countAvailableEscrows(req.params.id)

      res.json({
        status: 'purchasable',
        escrow_id: escrow.id,
        escrow_state: escrow.state,
        seller: escrow.seller,
        seller_reputation: sellerReputation,
        amount: escrow.amount,
        payment_token: escrow.payment_token,
        contract: ESCROW_CONTRACT,
        chain_id: CHAIN_ID,
        available_copies: available,
        total_sales: skill.total_sales,
        encrypted_data_ref: skill.encrypted_data_ref || '',
        fund_call: {
          function: 'fundEscrow(uint256,uint256)',
          args: [escrow.id, 0],
          value_wei: escrow.payment_token === '0x0000000000000000000000000000000000000000' ? escrow.amount : '0',
          note: 'For ERC20 tokens, approve() the contract first for the amount',
        },
      })
      return
    }

    // No available escrows — check if any were ever sold
    const allEscrows = db.listEscrowsForSkill(req.params.id)

    res.json({
      status: 'sold_out',
      seller: skill.seller,
      content_hash: skill.content_hash,
      encrypted_data_ref: skill.encrypted_data_ref || '',
      total_sales: skill.total_sales,
      note: allEscrows.length > 0
        ? 'All copies sold. Check back later or contact seller.'
        : 'No escrow created yet. Poll this endpoint or create a bounty.',
    })
  })

  return router
}
