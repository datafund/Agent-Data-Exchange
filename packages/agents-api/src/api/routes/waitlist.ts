import { Router } from 'express'
import { randomUUID } from 'crypto'
import { timingSafeEqual } from 'crypto'
import type { AgentsDatabase } from '../../db/database.js'
import { sanitize, isValidAddress } from '../sanitize.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function waitlistRoutes(db: AgentsDatabase): Router {
  const router = Router()

  // POST /waitlist — public, no auth
  router.post('/', (req, res) => {
    const { email, wallet, agent_name, agent_description, platform, skills_offered, skills_wanted, use_case, website, github, mcp_endpoint } = req.body

    if (!email || !EMAIL_RE.test(email)) {
      res.status(400).json({ error: 'Valid email is required' })
      return
    }

    if (wallet && !isValidAddress(wallet)) {
      res.status(400).json({ error: 'Invalid wallet address' })
      return
    }

    const id = randomUUID()
    const now = Math.floor(Date.now() / 1000)

    const created = db.createWaitlistEntry({
      id,
      email: sanitize(email),
      wallet: wallet ?? '',
      agentName: sanitize(agent_name),
      agentDescription: sanitize(agent_description),
      platform: sanitize(platform),
      skillsOffered: Array.isArray(skills_offered) ? skills_offered.map((s: unknown) => sanitize(s)) : [],
      skillsWanted: Array.isArray(skills_wanted) ? skills_wanted.map((s: unknown) => sanitize(s)) : [],
      useCase: sanitize(use_case),
      website: sanitize(website),
      github: sanitize(github),
      mcpEndpoint: sanitize(mcp_endpoint),
      createdAt: now,
    })

    if (!created) {
      res.status(409).json({ error: 'Email already registered' })
      return
    }

    res.status(201).json({ id, email: email.toLowerCase(), created_at: now })
  })

  // GET /waitlist — dashboard-token protected
  router.get('/', (req, res) => {
    const token = process.env.SX_DASHBOARD_TOKEN
    if (!token) return res.status(503).json({ error: 'Dashboard not configured' })

    const auth = req.headers.authorization ?? ''
    const expected = `Bearer ${token}`
    if (auth.length !== expected.length ||
        !timingSafeEqual(Buffer.from(auth), Buffer.from(expected))) {
      return res.status(401).json({ error: 'Invalid token' })
    }

    const limit = req.query.limit ? Number(req.query.limit) : 50
    const offset = req.query.offset ? Number(req.query.offset) : 0

    const entries = db.listWaitlistEntries({ limit, offset })
    const total = db.countWaitlistEntries()

    res.json({
      entries: entries.map(e => ({
        ...e,
        skills_offered: JSON.parse(e.skills_offered),
        skills_wanted: JSON.parse(e.skills_wanted),
      })),
      total,
    })
  })

  return router
}
