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
import { dashboardRoutes } from './routes/dashboard.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export function createServer(db: AgentsDatabase, indexer: EscrowIndexer) {
  const app = express()

  // Trust proxy (Caddy reverse proxy)
  app.set('trust proxy', 1)

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

  app.use(express.json())

  // API v1 routes
  const v1 = express.Router()
  v1.use('/agents', agentRoutes(db))
  v1.use('/wallets', walletRoutes(db))
  v1.use('/escrows', escrowRoutes(db))
  v1.use('/bounties', bountyRoutes(db))
  v1.use('/stats', statsRoutes(db, indexer))
  v1.use('/dashboard', dashboardRoutes(db, indexer))

  app.use('/api/v1', v1)

  // Serve skill.md with correct content type
  app.get('/skill.md', (_req, res) => {
    res.sendFile(join(__dirname, '../../public/skill.md'))
  })

  // Serve static files (landing page)
  app.use(express.static(join(__dirname, '../../public')))

  return app
}
