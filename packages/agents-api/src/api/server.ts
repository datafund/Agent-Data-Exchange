import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import express from 'express'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
import type { AgentsDatabase } from '../db/database.js'
import type { EscrowIndexer } from '../indexer/escrow-indexer.js'
import { agentRoutes } from './routes/agents.js'
import { walletRoutes } from './routes/wallets.js'
import { escrowRoutes } from './routes/escrows.js'
import { statsRoutes } from './routes/stats.js'
import { bountyRoutes } from './routes/bounties.js'
import { skillRoutes } from './routes/skills.js'
import { marketRoutes } from './routes/market.js'
import { dashboardRoutes } from './routes/dashboard.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export function createServer(db: AgentsDatabase, indexer: EscrowIndexer) {
  const app = express()

  // Trust proxy: only trust the immediate reverse proxy (Caddy on loopback).
  // In production Caddy runs on the same host; 'loopback' accepts 127.0.0.1/::1 only.
  // Falls back to 1 hop if TRUST_PROXY is set (e.g. for cloud load balancers).
  app.set('trust proxy', process.env.TRUST_PROXY || 'loopback')

  // CORS: allow fairdrop.xyz origins
  app.use(cors({
    origin: [
      /\.fairdrop\.xyz$/,
      /^https?:\/\/fairdrop\.xyz$/,
      /^https?:\/\/localhost(:\d+)?$/,
    ],
  }))

  // Rate limit: 100 req/min per IP
  app.use(rateLimit({
    windowMs: 60_000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
  }))

  app.use(express.json({ limit: '100kb' }))

  // Security headers
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('X-XSS-Protection', '0')
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
    next()
  })

  // API v1 routes
  const v1 = express.Router()
  v1.use('/agents', agentRoutes(db))
  v1.use('/wallets', walletRoutes(db))
  v1.use('/escrows', escrowRoutes(db))
  v1.use('/bounties', bountyRoutes(db))
  v1.use('/skills', skillRoutes(db))
  v1.use('/market', marketRoutes(db))
  v1.use('/stats', statsRoutes(db, indexer))
  v1.use('/dashboard', dashboardRoutes(db, indexer))

  // Health check alias (Caddy checks /api/v1/health)
  v1.get('/health', (_req, res) => {
    const status = indexer.getStatus()
    res.json({
      status: 'ok',
      indexer: status,
      skill_url: 'https://agents.datafund.io/skill.md',
      discovery_url: 'https://agents.datafund.io/.well-known/ai-plugin.json',
    })
  })

  // API v1 root — discovery document
  v1.get('/', (_req, res) => {
    res.json({
      name: 'Agent Data Exchange',
      version: '0.5.0',
      description: 'Sovereign data exchange between AI agents — trustless escrow on Base + Swarm',
      skill_url: 'https://agents.datafund.io/skill.md',
      discovery_url: 'https://agents.datafund.io/.well-known/ai-plugin.json',
      mcp_url: 'https://mcp.fairdrop.xyz',
      mcp_install: 'npx -y @datafund/agent-data-exchange',
      endpoints: {
        skills: '/api/v1/skills',
        bounties: '/api/v1/bounties',
        escrows: '/api/v1/escrows',
        agents: '/api/v1/agents',
        wallets: '/api/v1/wallets',
        stats: '/api/v1/stats',
        health: '/api/v1/stats/health',
        dashboard: '/api/v1/dashboard',
      },
      contract: {
        address: '0xDd4396d4F28d2b513175ae17dE11e56a898d19c3',
        chain: 'base',
        chain_id: 8453,
      },
    })
  })

  app.use('/api/v1', v1)

  // Well-known discovery for AI agents
  app.get('/.well-known/ai-plugin.json', (_req, res) => {
    res.sendFile(join(__dirname, '../../public/.well-known/ai-plugin.json'))
  })

  // Serve skill.md with correct content type
  app.get('/skill.md', (_req, res) => {
    res.sendFile(join(__dirname, '../../public/skill.md'))
  })

  // Serve static files (landing page)
  app.use(express.static(join(__dirname, '../../public')))

  // SPA fallback for /skills and /skill/:id
  app.get('/skills', (_req, res) => {
    res.sendFile(join(__dirname, '../../public/skills.html'))
  })
  app.get('/skill/:id', (_req, res) => {
    res.sendFile(join(__dirname, '../../public/skill.html'))
  })
  app.get('/agent/:id', (_req, res) => {
    res.sendFile(join(__dirname, '../../public/agent.html'))
  })
  app.get('/bounties', (_req, res) => {
    res.sendFile(join(__dirname, '../../public/bounties.html'))
  })
  app.get('/bounty/:id', (_req, res) => {
    res.sendFile(join(__dirname, '../../public/bounty.html'))
  })

  return app
}
