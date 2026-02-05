/**
 * SQLite database wrapper
 */

import Database from 'better-sqlite3'
import { readFileSync } from 'fs'
import { mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export class AgentsDatabase {
  private db: Database.Database

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.init()
  }

  private init() {
    const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8')
    this.db.exec(schema)
    this.migrate()
  }

  private migrate() {
    // Add escrow_id to skills and skill_id to escrows for linking
    const skillCols = this.db.pragma('table_info(skills)') as { name: string }[]
    if (!skillCols.some(c => c.name === 'escrow_id')) {
      this.db.exec('ALTER TABLE skills ADD COLUMN escrow_id INTEGER')
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_skills_escrow ON skills(escrow_id)')
    }
    const escrowCols = this.db.pragma('table_info(escrows)') as { name: string }[]
    if (!escrowCols.some(c => c.name === 'skill_id')) {
      this.db.exec("ALTER TABLE escrows ADD COLUMN skill_id TEXT DEFAULT ''")
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_escrows_skill ON escrows(skill_id)')
    }
    // Add encrypted Swarm reference for buyer-side download
    if (!skillCols.some(c => c.name === 'encrypted_data_ref')) {
      this.db.exec("ALTER TABLE skills ADD COLUMN encrypted_data_ref TEXT DEFAULT ''")
    }
  }

  // === Monitor State ===

  getLastBlock(chainId: number): bigint {
    const row = this.db.prepare('SELECT last_block FROM monitor_state WHERE chain_id = ?').get(chainId) as { last_block: number } | undefined
    return BigInt(row?.last_block ?? 0)
  }

  setLastBlock(chainId: number, block: bigint) {
    this.db.prepare(
      `INSERT INTO monitor_state (chain_id, last_block, last_updated)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(chain_id) DO UPDATE SET last_block = ?, last_updated = datetime('now')`
    ).run(chainId, Number(block), Number(block))
  }

  // === Escrow Events ===

  insertEvent(event: {
    chainId: number
    txHash: string
    logIndex: number
    blockNumber: number
    blockTimestamp: number
    escrowId: number
    eventType: string
    eventData: Record<string, unknown>
  }): boolean {
    try {
      this.db.prepare(
        `INSERT INTO escrow_events (chain_id, tx_hash, log_index, block_number, block_timestamp, escrow_id, event_type, event_data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        event.chainId, event.txHash, event.logIndex, event.blockNumber,
        event.blockTimestamp, event.escrowId, event.eventType,
        JSON.stringify(event.eventData, (_, v) => typeof v === 'bigint' ? v.toString() : v)
      )
      return true
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') return false
      throw err
    }
  }

  // === Escrows ===

  upsertEscrow(escrow: {
    id: number
    chainId: number
    seller?: string
    buyer?: string
    paymentToken?: string
    sellerAgentId?: number
    buyerAgentId?: number
    amount?: string
    contentHash?: string
    disputeWindow?: number
    state?: string
    createdAt?: number
    fundedAt?: number | null
    committedAt?: number | null
    releasedAt?: number | null
    claimedAt?: number | null
    expiredAt?: number | null
    cancelledAt?: number | null
    disputedAt?: number | null
    resolvedAt?: number | null
    completed?: number
    disputed?: number
    disputeOutcome?: string | null
  }) {
    const existing = this.getEscrow(escrow.id)
    if (!existing) {
      this.db.prepare(
        `INSERT INTO escrows (id, chain_id, seller, buyer, payment_token, seller_agent_id, buyer_agent_id, amount, content_hash, dispute_window, state, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        escrow.id, escrow.chainId,
        escrow.seller ?? '', escrow.buyer ?? '', escrow.paymentToken ?? '',
        escrow.sellerAgentId ?? 0, escrow.buyerAgentId ?? 0,
        escrow.amount ?? '0', escrow.contentHash ?? '', escrow.disputeWindow ?? 0,
        escrow.state ?? 'created', escrow.createdAt ?? 0
      )
    }

    // Build dynamic update
    const updates: string[] = []
    const values: unknown[] = []

    const fields: [string, unknown, string][] = [
      ['buyer', escrow.buyer, 'buyer'],
      ['buyer_agent_id', escrow.buyerAgentId, 'buyerAgentId'],
      ['state', escrow.state, 'state'],
      ['funded_at', escrow.fundedAt, 'fundedAt'],
      ['committed_at', escrow.committedAt, 'committedAt'],
      ['released_at', escrow.releasedAt, 'releasedAt'],
      ['claimed_at', escrow.claimedAt, 'claimedAt'],
      ['expired_at', escrow.expiredAt, 'expiredAt'],
      ['cancelled_at', escrow.cancelledAt, 'cancelledAt'],
      ['disputed_at', escrow.disputedAt, 'disputedAt'],
      ['resolved_at', escrow.resolvedAt, 'resolvedAt'],
      ['completed', escrow.completed, 'completed'],
      ['disputed', escrow.disputed, 'disputed'],
      ['dispute_outcome', escrow.disputeOutcome, 'disputeOutcome'],
    ]

    for (const [col, val] of fields) {
      if (val !== undefined) {
        updates.push(`${col} = ?`)
        values.push(val)
      }
    }

    // Compute timing metrics
    if (escrow.fundedAt && existing?.created_at) {
      updates.push('time_to_fund = ?')
      values.push(escrow.fundedAt - existing.created_at)
    }
    if (escrow.releasedAt && existing?.funded_at) {
      updates.push('time_to_release = ?')
      values.push(escrow.releasedAt - existing.funded_at)
    }
    if (escrow.claimedAt && existing?.released_at) {
      updates.push('time_to_claim = ?')
      values.push(escrow.claimedAt - existing.released_at)
    }

    if (updates.length > 0) {
      updates.push("updated_at = datetime('now')")
      values.push(escrow.id)
      this.db.prepare(`UPDATE escrows SET ${updates.join(', ')} WHERE id = ?`).run(...values)
    }
  }

  getEscrow(id: number): EscrowRow | undefined {
    return this.db.prepare('SELECT * FROM escrows WHERE id = ?').get(id) as EscrowRow | undefined
  }

  listEscrows(opts: { seller?: string; buyer?: string; state?: string; limit?: number; offset?: number }): EscrowRow[] {
    const conditions: string[] = []
    const values: unknown[] = []

    if (opts.seller) { conditions.push('seller = ?'); values.push(opts.seller.toLowerCase()) }
    if (opts.buyer) { conditions.push('buyer = ?'); values.push(opts.buyer.toLowerCase()) }
    if (opts.state) { conditions.push('state = ?'); values.push(opts.state) }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const limit = opts.limit ?? 50
    const offset = opts.offset ?? 0

    return this.db.prepare(
      `SELECT * FROM escrows ${where} ORDER BY id DESC LIMIT ? OFFSET ?`
    ).all(...values, limit, offset) as EscrowRow[]
  }

  countEscrows(opts: { seller?: string; buyer?: string; state?: string }): number {
    const conditions: string[] = []
    const values: unknown[] = []

    if (opts.seller) { conditions.push('seller = ?'); values.push(opts.seller.toLowerCase()) }
    if (opts.buyer) { conditions.push('buyer = ?'); values.push(opts.buyer.toLowerCase()) }
    if (opts.state) { conditions.push('state = ?'); values.push(opts.state) }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const row = this.db.prepare(`SELECT COUNT(*) as count FROM escrows ${where}`).get(...values) as { count: number }
    return row.count
  }

  // === Agent Reputation ===

  getAgentReputation(agentId: number): AgentReputationRow | undefined {
    return this.db.prepare('SELECT * FROM agent_reputation WHERE agent_id = ?').get(agentId) as AgentReputationRow | undefined
  }

  upsertAgentReputation(rep: AgentReputationRow) {
    this.db.prepare(
      `INSERT INTO agent_reputation (agent_id, total_created, total_funded, total_completed, total_disputed, total_cancelled,
         total_volume, volume_30d, completion_rate, dispute_rate, cancellation_rate, reputation_score, first_escrow_at, last_escrow_at, last_updated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(agent_id) DO UPDATE SET
         total_created=?, total_funded=?, total_completed=?, total_disputed=?, total_cancelled=?,
         total_volume=?, volume_30d=?, completion_rate=?, dispute_rate=?, cancellation_rate=?,
         reputation_score=?, first_escrow_at=?, last_escrow_at=?, last_updated=datetime('now')`
    ).run(
      rep.agent_id, rep.total_created, rep.total_funded, rep.total_completed, rep.total_disputed, rep.total_cancelled,
      rep.total_volume, rep.volume_30d, rep.completion_rate, rep.dispute_rate, rep.cancellation_rate,
      rep.reputation_score, rep.first_escrow_at, rep.last_escrow_at,
      // UPDATE values
      rep.total_created, rep.total_funded, rep.total_completed, rep.total_disputed, rep.total_cancelled,
      rep.total_volume, rep.volume_30d, rep.completion_rate, rep.dispute_rate, rep.cancellation_rate,
      rep.reputation_score, rep.first_escrow_at, rep.last_escrow_at,
    )
  }

  // === Wallet Reputation ===

  getWalletReputation(address: string): { seller?: WalletReputationRow; buyer?: WalletReputationRow } {
    const addr = address.toLowerCase()
    const seller = this.db.prepare('SELECT * FROM wallet_reputation WHERE address = ? AND role = ?').get(addr, 'seller') as WalletReputationRow | undefined
    const buyer = this.db.prepare('SELECT * FROM wallet_reputation WHERE address = ? AND role = ?').get(addr, 'buyer') as WalletReputationRow | undefined
    return { seller, buyer }
  }

  upsertWalletReputation(rep: WalletReputationRow) {
    this.db.prepare(
      `INSERT INTO wallet_reputation (address, role, total_created, total_funded, total_completed, total_disputed, total_cancelled,
         total_volume, volume_30d, completion_rate, dispute_rate, cancellation_rate, reputation_score,
         avg_delivery_seconds, first_escrow_at, last_escrow_at, last_updated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(address, role) DO UPDATE SET
         total_created=?, total_funded=?, total_completed=?, total_disputed=?, total_cancelled=?,
         total_volume=?, volume_30d=?, completion_rate=?, dispute_rate=?, cancellation_rate=?,
         reputation_score=?, avg_delivery_seconds=?, first_escrow_at=?, last_escrow_at=?, last_updated=datetime('now')`
    ).run(
      rep.address, rep.role,
      rep.total_created, rep.total_funded, rep.total_completed, rep.total_disputed, rep.total_cancelled,
      rep.total_volume, rep.volume_30d, rep.completion_rate, rep.dispute_rate, rep.cancellation_rate,
      rep.reputation_score, rep.avg_delivery_seconds, rep.first_escrow_at, rep.last_escrow_at,
      // UPDATE
      rep.total_created, rep.total_funded, rep.total_completed, rep.total_disputed, rep.total_cancelled,
      rep.total_volume, rep.volume_30d, rep.completion_rate, rep.dispute_rate, rep.cancellation_rate,
      rep.reputation_score, rep.avg_delivery_seconds, rep.first_escrow_at, rep.last_escrow_at,
    )
  }

  // === Protocol Stats ===

  getProtocolStats(): ProtocolStatsRow {
    return this.db.prepare('SELECT * FROM protocol_stats WHERE id = 1').get() as ProtocolStatsRow
  }

  updateProtocolStats() {
    this.db.prepare(`
      UPDATE protocol_stats SET
        total_escrows = (SELECT COUNT(*) FROM escrows),
        total_funded = (SELECT COUNT(*) FROM escrows WHERE funded_at IS NOT NULL),
        total_completed = (SELECT COUNT(*) FROM escrows WHERE completed = 1),
        total_disputed = (SELECT COUNT(*) FROM escrows WHERE disputed = 1),
        unique_sellers = (SELECT COUNT(DISTINCT seller) FROM escrows WHERE seller != ''),
        unique_buyers = (SELECT COUNT(DISTINCT buyer) FROM escrows WHERE buyer != ''),
        unique_agents = (SELECT COUNT(*) FROM agent_reputation),
        total_bounties = (SELECT COUNT(*) FROM bounties),
        total_bounties_fulfilled = (SELECT COUNT(*) FROM bounties WHERE status = 'fulfilled'),
        last_updated = datetime('now')
      WHERE id = 1
    `).run()
  }

  // === Dashboard analytics ===

  getConversionFunnel(): { total: number; funded: number; committed: number; released: number; claimed: number } {
    const row = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN funded_at IS NOT NULL THEN 1 ELSE 0 END) as funded,
        SUM(CASE WHEN committed_at IS NOT NULL THEN 1 ELSE 0 END) as committed,
        SUM(CASE WHEN released_at IS NOT NULL THEN 1 ELSE 0 END) as released,
        SUM(CASE WHEN claimed_at IS NOT NULL THEN 1 ELSE 0 END) as claimed
      FROM escrows
    `).get() as Record<string, number>
    return {
      total: row.total ?? 0,
      funded: row.funded ?? 0,
      committed: row.committed ?? 0,
      released: row.released ?? 0,
      claimed: row.claimed ?? 0,
    }
  }

  getAvgTimings(): { avg_to_fund: number | null; avg_to_release: number | null; avg_to_claim: number | null } {
    const row = this.db.prepare(`
      SELECT
        AVG(time_to_fund) as avg_to_fund,
        AVG(time_to_release) as avg_to_release,
        AVG(time_to_claim) as avg_to_claim
      FROM escrows WHERE completed = 1
    `).get() as Record<string, number | null>
    return {
      avg_to_fund: row.avg_to_fund,
      avg_to_release: row.avg_to_release,
      avg_to_claim: row.avg_to_claim,
    }
  }

  getEscrowStateDistribution(): { state: string; count: number }[] {
    return this.db.prepare(
      'SELECT state, COUNT(*) as count FROM escrows GROUP BY state ORDER BY count DESC'
    ).all() as { state: string; count: number }[]
  }

  getEscrowTimeline(days: number): { date: string; created: number; funded: number; completed: number }[] {
    const cutoff = Math.floor(Date.now() / 1000) - (days * 86400)
    return this.db.prepare(`
      SELECT
        date(created_at, 'unixepoch') as date,
        COUNT(*) as created,
        SUM(CASE WHEN funded_at IS NOT NULL THEN 1 ELSE 0 END) as funded,
        SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) as completed
      FROM escrows
      WHERE created_at > ?
      GROUP BY date(created_at, 'unixepoch')
      ORDER BY date ASC
    `).all(cutoff) as { date: string; created: number; funded: number; completed: number }[]
  }

  getTopAgents(limit: number): AgentReputationRow[] {
    return this.db.prepare(
      'SELECT * FROM agent_reputation ORDER BY reputation_score DESC LIMIT ?'
    ).all(limit) as AgentReputationRow[]
  }

  getRecentEvents(limit: number): EscrowEventRow[] {
    return this.db.prepare(
      'SELECT * FROM escrow_events ORDER BY block_timestamp DESC, log_index DESC LIMIT ?'
    ).all(limit) as EscrowEventRow[]
  }

  // === Directory listings ===

  listAgentReputations(opts: { limit?: number; offset?: number } = {}): AgentReputationRow[] {
    const limit = Math.min(opts.limit ?? 50, 100)
    const offset = opts.offset ?? 0
    return this.db.prepare(
      'SELECT * FROM agent_reputation ORDER BY reputation_score DESC LIMIT ? OFFSET ?'
    ).all(limit, offset) as AgentReputationRow[]
  }

  countAgentReputations(): number {
    return (this.db.prepare('SELECT COUNT(*) as count FROM agent_reputation').get() as { count: number }).count
  }

  listWalletReputations(opts: { role?: string; limit?: number; offset?: number } = {}): WalletReputationRow[] {
    const limit = Math.min(opts.limit ?? 50, 100)
    const offset = opts.offset ?? 0
    if (opts.role) {
      return this.db.prepare(
        'SELECT * FROM wallet_reputation WHERE role = ? ORDER BY reputation_score DESC LIMIT ? OFFSET ?'
      ).all(opts.role, limit, offset) as WalletReputationRow[]
    }
    return this.db.prepare(
      'SELECT * FROM wallet_reputation ORDER BY reputation_score DESC LIMIT ? OFFSET ?'
    ).all(limit, offset) as WalletReputationRow[]
  }

  countWalletReputations(role?: string): number {
    if (role) {
      return (this.db.prepare('SELECT COUNT(*) as count FROM wallet_reputation WHERE role = ?').get(role) as { count: number }).count
    }
    return (this.db.prepare('SELECT COUNT(*) as count FROM wallet_reputation').get() as { count: number }).count
  }

  // === Aggregation queries for reputation calculation ===

  getAgentEscrowStats(agentId: number): {
    asSellerCreated: number; asSellerCompleted: number; asSellerDisputed: number; asSellerCancelled: number;
    asBuyerFunded: number; asBuyerCompleted: number; asBuyerDisputed: number;
    totalVolume: string; avgDeliverySeconds: number | null;
    firstEscrowAt: number | null; lastEscrowAt: number | null;
  } {
    const seller = this.db.prepare(`
      SELECT COUNT(*) as cnt, SUM(CASE WHEN completed=1 THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN disputed=1 THEN 1 ELSE 0 END) as disputed,
        SUM(CASE WHEN state='cancelled' THEN 1 ELSE 0 END) as cancelled,
        COALESCE(SUM(CAST(amount AS INTEGER)), 0) as vol,
        AVG(CASE WHEN time_to_release IS NOT NULL THEN time_to_release END) as avg_delivery,
        MIN(created_at) as first_at, MAX(created_at) as last_at
      FROM escrows WHERE seller_agent_id = ?
    `).get(agentId) as Record<string, number | null>

    const buyer = this.db.prepare(`
      SELECT COUNT(*) as cnt, SUM(CASE WHEN completed=1 THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN disputed=1 THEN 1 ELSE 0 END) as disputed
      FROM escrows WHERE buyer_agent_id = ?
    `).get(agentId) as Record<string, number | null>

    return {
      asSellerCreated: (seller.cnt ?? 0) as number,
      asSellerCompleted: (seller.completed ?? 0) as number,
      asSellerDisputed: (seller.disputed ?? 0) as number,
      asSellerCancelled: (seller.cancelled ?? 0) as number,
      asBuyerFunded: (buyer.cnt ?? 0) as number,
      asBuyerCompleted: (buyer.completed ?? 0) as number,
      asBuyerDisputed: (buyer.disputed ?? 0) as number,
      totalVolume: String(seller.vol ?? 0),
      avgDeliverySeconds: seller.avg_delivery as number | null,
      firstEscrowAt: seller.first_at as number | null,
      lastEscrowAt: seller.last_at as number | null,
    }
  }

  getWalletEscrowStats(address: string, role: 'seller' | 'buyer'): {
    total: number; completed: number; disputed: number; cancelled: number;
    totalVolume: string; avgDeliverySeconds: number | null;
    firstEscrowAt: number | null; lastEscrowAt: number | null;
  } {
    if (role !== 'seller' && role !== 'buyer') throw new Error('Invalid role')
    const col = role === 'seller' ? 'seller' : 'buyer'
    const row = this.db.prepare(`
      SELECT COUNT(*) as cnt, SUM(CASE WHEN completed=1 THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN disputed=1 THEN 1 ELSE 0 END) as disputed,
        SUM(CASE WHEN state='cancelled' THEN 1 ELSE 0 END) as cancelled,
        COALESCE(SUM(CAST(amount AS INTEGER)), 0) as vol,
        AVG(CASE WHEN time_to_release IS NOT NULL THEN time_to_release END) as avg_delivery,
        MIN(created_at) as first_at, MAX(created_at) as last_at
      FROM escrows WHERE ${col} = ?
    `).get(address.toLowerCase()) as Record<string, number | null>

    return {
      total: (row.cnt ?? 0) as number,
      completed: (row.completed ?? 0) as number,
      disputed: (row.disputed ?? 0) as number,
      cancelled: (row.cancelled ?? 0) as number,
      totalVolume: String(row.vol ?? 0),
      avgDeliverySeconds: row.avg_delivery as number | null,
      firstEscrowAt: row.first_at as number | null,
      lastEscrowAt: row.last_at as number | null,
    }
  }

  getEscrowsByAgent(agentId: number, opts: { limit?: number; offset?: number }): EscrowRow[] {
    return this.db.prepare(
      `SELECT * FROM escrows WHERE seller_agent_id = ? OR buyer_agent_id = ? ORDER BY id DESC LIMIT ? OFFSET ?`
    ).all(agentId, agentId, opts.limit ?? 50, opts.offset ?? 0) as EscrowRow[]
  }

  countEscrowsByAgent(agentId: number): number {
    const row = this.db.prepare(
      `SELECT COUNT(*) as count FROM escrows WHERE seller_agent_id = ? OR buyer_agent_id = ?`
    ).get(agentId, agentId) as { count: number }
    return row.count
  }

  getEscrowsByWallet(address: string, opts: { limit?: number; offset?: number }): EscrowRow[] {
    const addr = address.toLowerCase()
    return this.db.prepare(
      `SELECT * FROM escrows WHERE seller = ? OR buyer = ? ORDER BY id DESC LIMIT ? OFFSET ?`
    ).all(addr, addr, opts.limit ?? 50, opts.offset ?? 0) as EscrowRow[]
  }

  countEscrowsByWallet(address: string): number {
    const addr = address.toLowerCase()
    const row = this.db.prepare(
      `SELECT COUNT(*) as count FROM escrows WHERE seller = ? OR buyer = ?`
    ).get(addr, addr) as { count: number }
    return row.count
  }

  // === Bounties ===

  createBounty(bounty: {
    id: string
    poster: string
    posterAgentId?: number
    title: string
    description?: string
    category?: string
    rewardAmount?: string
    rewardToken?: string
    tags?: string[]
    moltbookPostId?: string
    createdAt: number
    expiresAt: number
  }): boolean {
    try {
      this.db.prepare(
        `INSERT INTO bounties (id, poster, poster_agent_id, title, description, category, reward_amount, reward_token, tags, moltbook_post_id, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        bounty.id, bounty.poster.toLowerCase(), bounty.posterAgentId ?? 0,
        bounty.title, bounty.description ?? '', bounty.category ?? '',
        bounty.rewardAmount ?? '0', bounty.rewardToken ?? 'USDC',
        JSON.stringify(bounty.tags ?? []), bounty.moltbookPostId ?? null,
        bounty.createdAt, bounty.expiresAt,
      )
      return true
    } catch {
      return false
    }
  }

  getBounty(id: string): BountyRow | undefined {
    return this.db.prepare('SELECT * FROM bounties WHERE id = ?').get(id) as BountyRow | undefined
  }

  listBounties(opts: { poster?: string; category?: string; status?: string; limit?: number; offset?: number }): BountyRow[] {
    const conditions: string[] = []
    const values: unknown[] = []

    if (opts.poster) { conditions.push('poster = ?'); values.push(opts.poster.toLowerCase()) }
    if (opts.category) { conditions.push('category = ?'); values.push(opts.category) }
    if (opts.status) { conditions.push('status = ?'); values.push(opts.status) }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    return this.db.prepare(
      `SELECT * FROM bounties ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(...values, opts.limit ?? 50, opts.offset ?? 0) as BountyRow[]
  }

  countBounties(opts: { poster?: string; status?: string }): number {
    const conditions: string[] = []
    const values: unknown[] = []

    if (opts.poster) { conditions.push('poster = ?'); values.push(opts.poster.toLowerCase()) }
    if (opts.status) { conditions.push('status = ?'); values.push(opts.status) }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const row = this.db.prepare(`SELECT COUNT(*) as count FROM bounties ${where}`).get(...values) as { count: number }
    return row.count
  }

  fulfillBounty(id: string, escrowId: number) {
    this.db.prepare(
      `UPDATE bounties SET status = 'fulfilled', escrow_id = ?, fulfilled_at = ? WHERE id = ?`
    ).run(escrowId, Math.floor(Date.now() / 1000), id)
  }

  cancelBounty(id: string) {
    this.db.prepare(
      `UPDATE bounties SET status = 'cancelled', cancelled_at = ? WHERE id = ?`
    ).run(Math.floor(Date.now() / 1000), id)
  }

  expireOldBounties() {
    const now = Math.floor(Date.now() / 1000)
    this.db.prepare(
      `UPDATE bounties SET status = 'expired' WHERE status = 'open' AND expires_at < ?`
    ).run(now)
  }

  getBountyStatsForWallet(address: string): { total: number; fulfilled: number; expired: number; cancelled: number } {
    const row = this.db.prepare(`
      SELECT COUNT(*) as total,
        SUM(CASE WHEN status='fulfilled' THEN 1 ELSE 0 END) as fulfilled,
        SUM(CASE WHEN status='expired' THEN 1 ELSE 0 END) as expired,
        SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) as cancelled
      FROM bounties WHERE poster = ?
    `).get(address.toLowerCase()) as Record<string, number>
    return {
      total: row.total ?? 0,
      fulfilled: row.fulfilled ?? 0,
      expired: row.expired ?? 0,
      cancelled: row.cancelled ?? 0,
    }
  }

  // === Skills ===

  createSkill(skill: {
    id: string
    seller: string
    sellerAgentId?: number
    title: string
    description?: string
    longDescription?: string
    category?: string
    price?: string
    priceToken?: string
    tags?: string[]
    delivery?: string
    contentHash?: string
    encryptedDataRef?: string
    createdAt: number
  }): boolean {
    try {
      this.db.prepare(
        `INSERT INTO skills (id, seller, seller_agent_id, title, description, long_description, category, price, price_token, tags, delivery, content_hash, encrypted_data_ref, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        skill.id, skill.seller.toLowerCase(), skill.sellerAgentId ?? 0,
        skill.title, skill.description ?? '', skill.longDescription ?? '',
        skill.category ?? '', skill.price ?? '0', skill.priceToken ?? 'ETH',
        JSON.stringify(skill.tags ?? []), skill.delivery ?? 'instant',
        skill.contentHash ?? '', skill.encryptedDataRef ?? '', skill.createdAt,
      )
      return true
    } catch {
      return false
    }
  }

  getSkill(id: string): SkillRow | undefined {
    return this.db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as SkillRow | undefined
  }

  listSkills(opts: { seller?: string; category?: string; status?: string; limit?: number; offset?: number }): SkillRow[] {
    const conditions: string[] = []
    const values: unknown[] = []

    if (opts.seller) { conditions.push('seller = ?'); values.push(opts.seller.toLowerCase()) }
    if (opts.category) { conditions.push('category = ?'); values.push(opts.category) }
    conditions.push('status = ?'); values.push(opts.status ?? 'active')

    const where = `WHERE ${conditions.join(' AND ')}`
    return this.db.prepare(
      `SELECT * FROM skills ${where} ORDER BY total_sales DESC, created_at DESC LIMIT ? OFFSET ?`
    ).all(...values, opts.limit ?? 50, opts.offset ?? 0) as SkillRow[]
  }

  countSkills(opts: { seller?: string; category?: string; status?: string }): number {
    const conditions: string[] = []
    const values: unknown[] = []

    if (opts.seller) { conditions.push('seller = ?'); values.push(opts.seller.toLowerCase()) }
    if (opts.category) { conditions.push('category = ?'); values.push(opts.category) }
    conditions.push('status = ?'); values.push(opts.status ?? 'active')

    const where = `WHERE ${conditions.join(' AND ')}`
    const row = this.db.prepare(`SELECT COUNT(*) as count FROM skills ${where}`).get(...values) as { count: number }
    return row.count
  }

  linkSkillToEscrow(skillId: string, escrowId: number) {
    // Always link escrow → skill (multi-copy: many escrows per skill)
    this.db.prepare("UPDATE escrows SET skill_id = ?, updated_at = datetime('now') WHERE id = ?").run(skillId, escrowId)
    // Set skill.escrow_id only if not already set (backward compat — first escrow)
    this.db.prepare("UPDATE skills SET escrow_id = ?, updated_at = datetime('now') WHERE id = ? AND escrow_id IS NULL").run(escrowId, skillId)
  }

  findSkillByContentHash(seller: string, contentHash: string): SkillRow | undefined {
    return this.db.prepare(
      'SELECT * FROM skills WHERE seller = ? AND content_hash = ? ORDER BY created_at DESC LIMIT 1'
    ).get(seller.toLowerCase(), contentHash) as SkillRow | undefined
  }

  /**
   * Get the next available (unfunded) escrow for a skill.
   * Returns the oldest created escrow in 'created' state linked to this skill.
   */
  getAvailableEscrowForSkill(skillId: string): EscrowRow | undefined {
    return this.db.prepare(
      "SELECT * FROM escrows WHERE skill_id = ? AND state = 'created' ORDER BY id ASC LIMIT 1"
    ).get(skillId) as EscrowRow | undefined
  }

  /**
   * Count available (unfunded) escrows for a skill.
   */
  countAvailableEscrows(skillId: string): number {
    const row = this.db.prepare(
      "SELECT COUNT(*) as count FROM escrows WHERE skill_id = ? AND state = 'created'"
    ).get(skillId) as { count: number }
    return row.count
  }

  /**
   * List all escrows linked to a skill, with optional state filter.
   */
  listEscrowsForSkill(skillId: string, state?: string): EscrowRow[] {
    if (state) {
      return this.db.prepare(
        'SELECT * FROM escrows WHERE skill_id = ? AND state = ? ORDER BY id ASC'
      ).all(skillId, state) as EscrowRow[]
    }
    return this.db.prepare(
      'SELECT * FROM escrows WHERE skill_id = ? ORDER BY id ASC'
    ).all(skillId) as EscrowRow[]
  }

  getEscrowEvents(escrowId: number, sinceTimestamp: number): EscrowEventRow[] {
    return this.db.prepare(
      'SELECT * FROM escrow_events WHERE escrow_id = ? AND block_timestamp > ? ORDER BY block_timestamp ASC, log_index ASC'
    ).all(escrowId, sinceTimestamp) as EscrowEventRow[]
  }

  incrementSkillSales(id: string) {
    this.db.prepare(`UPDATE skills SET total_sales = total_sales + 1, updated_at = datetime('now') WHERE id = ?`).run(id)
  }

  // === Votes ===
  upsertVote(vote: { voter: string; voterAgentId?: number; targetType: string; targetId: string; value: number }) {
    const now = Math.floor(Date.now() / 1000)
    this.db.prepare(
      `INSERT INTO votes (voter, voter_agent_id, target_type, target_id, value, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(voter, target_type, target_id) DO UPDATE SET value = excluded.value, created_at = excluded.created_at`
    ).run(vote.voter.toLowerCase(), vote.voterAgentId ?? 0, vote.targetType, vote.targetId, vote.value, now)
  }

  getVoteSummary(targetType: string, targetId: string): { upvotes: number; downvotes: number; score: number } {
    const row = this.db.prepare(
      `SELECT COALESCE(SUM(CASE WHEN value > 0 THEN 1 ELSE 0 END), 0) as upvotes,
              COALESCE(SUM(CASE WHEN value < 0 THEN 1 ELSE 0 END), 0) as downvotes,
              COALESCE(SUM(value), 0) as score
       FROM votes WHERE target_type = ? AND target_id = ?`
    ).get(targetType, targetId) as { upvotes: number; downvotes: number; score: number }
    return row
  }

  getUserVote(voter: string, targetType: string, targetId: string): number {
    const row = this.db.prepare(
      `SELECT value FROM votes WHERE voter = ? AND target_type = ? AND target_id = ?`
    ).get(voter.toLowerCase(), targetType, targetId) as { value: number } | undefined
    return row?.value ?? 0
  }

  // === Comments ===
  addComment(comment: { author: string; authorAgentId?: number; targetType: string; targetId: string; body: string }) {
    const now = Math.floor(Date.now() / 1000)
    const result = this.db.prepare(
      `INSERT INTO comments (author, author_agent_id, target_type, target_id, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(comment.author.toLowerCase(), comment.authorAgentId ?? 0, comment.targetType, comment.targetId, comment.body, now)
    return { id: result.lastInsertRowid, createdAt: now }
  }

  listComments(targetType: string, targetId: string, limit = 50, offset = 0): CommentRow[] {
    return this.db.prepare(
      `SELECT * FROM comments WHERE target_type = ? AND target_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(targetType, targetId, limit, offset) as CommentRow[]
  }

  countComments(targetType: string, targetId: string): number {
    const row = this.db.prepare(
      `SELECT COUNT(*) as count FROM comments WHERE target_type = ? AND target_id = ?`
    ).get(targetType, targetId) as { count: number }
    return row.count
  }

  close() {
    this.db.close()
  }

  // === Market Analytics ===

  getMarketSummary(timeframeDays: number = 7): MarketSummaryRow {
    const cutoff = Math.floor(Date.now() / 1000) - (timeframeDays * 86400)

    // Basic counts
    const stats = this.db.prepare(`
      SELECT
        COUNT(*) as total_escrows,
        SUM(CASE WHEN state = 'created' THEN 1 ELSE 0 END) as active_listings,
        SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) as total_completed,
        COALESCE(SUM(CASE WHEN completed = 1 THEN CAST(amount AS INTEGER) ELSE 0 END), 0) as total_volume
      FROM escrows
    `).get() as Record<string, number>

    // Recent volume
    const recentVolume = this.db.prepare(`
      SELECT COALESCE(SUM(CAST(amount AS INTEGER)), 0) as vol
      FROM escrows
      WHERE completed = 1 AND claimed_at > ?
    `).get(cutoff) as { vol: number }

    // Open bounties count
    const openBounties = this.db.prepare(`
      SELECT COUNT(*) as count FROM bounties WHERE status = 'open'
    `).get() as { count: number }

    // Category stats from completed escrows via skills
    const categoryStats = this.db.prepare(`
      SELECT
        s.category,
        COUNT(DISTINCT e.id) as escrow_count,
        COALESCE(SUM(CAST(e.amount AS INTEGER)), 0) as volume
      FROM escrows e
      JOIN skills s ON e.skill_id = s.id
      WHERE e.completed = 1 AND s.category != ''
      GROUP BY s.category
      ORDER BY volume DESC
      LIMIT 10
    `).all() as { category: string; escrow_count: number; volume: number }[]

    // Trending: categories with most recent activity
    const trending = this.db.prepare(`
      SELECT
        s.category,
        COUNT(*) as recent_count
      FROM escrows e
      JOIN skills s ON e.skill_id = s.id
      WHERE e.created_at > ? AND s.category != ''
      GROUP BY s.category
      ORDER BY recent_count DESC
      LIMIT 5
    `).all(cutoff) as { category: string; recent_count: number }[]

    // Underserved: categories with bounties but few listings
    const underserved = this.db.prepare(`
      SELECT
        b.category,
        COUNT(DISTINCT b.id) as bounty_count,
        (SELECT COUNT(*) FROM skills WHERE category = b.category AND status = 'active') as listing_count
      FROM bounties b
      WHERE b.status = 'open' AND b.category != ''
      GROUP BY b.category
      HAVING bounty_count > listing_count
      ORDER BY (bounty_count - listing_count) DESC
      LIMIT 5
    `).all() as { category: string; bounty_count: number; listing_count: number }[]

    return {
      total_escrows: stats.total_escrows ?? 0,
      active_listings: stats.active_listings ?? 0,
      open_bounties: openBounties.count ?? 0,
      total_volume: String(stats.total_volume ?? 0),
      volume_period: String(recentVolume.vol ?? 0),
      total_completed: stats.total_completed ?? 0,
      is_early_network: (stats.total_escrows ?? 0) < 50,
      top_categories: categoryStats.map(c => ({
        category: c.category,
        escrow_count: c.escrow_count,
        volume: String(c.volume),
      })),
      trending_categories: trending.map(t => t.category),
      underserved_categories: underserved.map(u => ({
        category: u.category,
        bounty_count: u.bounty_count,
        listing_count: u.listing_count,
      })),
    }
  }

  getCategoryPricing(category: string, tags?: string[]): CategoryPricingRow {
    // Get pricing from completed escrows in this category
    const baseQuery = `
      SELECT
        MIN(CAST(e.amount AS INTEGER)) as min_price,
        MAX(CAST(e.amount AS INTEGER)) as max_price,
        AVG(CAST(e.amount AS REAL)) as avg_price,
        COUNT(*) as sample_size
      FROM escrows e
      JOIN skills s ON e.skill_id = s.id
      WHERE e.completed = 1 AND s.category = ?
    `

    const result = this.db.prepare(baseQuery).get(category) as {
      min_price: number | null
      max_price: number | null
      avg_price: number | null
      sample_size: number
    }

    // Calculate median separately
    const prices = this.db.prepare(`
      SELECT CAST(e.amount AS INTEGER) as price
      FROM escrows e
      JOIN skills s ON e.skill_id = s.id
      WHERE e.completed = 1 AND s.category = ?
      ORDER BY price
    `).all(category) as { price: number }[]

    const median = prices.length > 0
      ? prices[Math.floor(prices.length / 2)].price
      : null

    // Demand score: ratio of bounties to completed sales
    const demandData = this.db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM bounties WHERE category = ? AND status = 'open') as open_bounties,
        (SELECT COUNT(*) FROM skills WHERE category = ? AND status = 'active') as active_listings
    `).get(category, category) as { open_bounties: number; active_listings: number }

    const demandScore = demandData.active_listings > 0
      ? Math.min(10, Math.round((demandData.open_bounties / demandData.active_listings) * 5))
      : (demandData.open_bounties > 0 ? 10 : 0)

    return {
      category,
      min_price: result.min_price ? String(result.min_price) : null,
      max_price: result.max_price ? String(result.max_price) : null,
      avg_price: result.avg_price ? String(Math.round(result.avg_price)) : null,
      median_price: median ? String(median) : null,
      sample_size: result.sample_size ?? 0,
      insufficient_data: (result.sample_size ?? 0) < 5,
      demand_score: demandScore,
    }
  }

  getMarketActivity(categories: string[], sinceTimestamp: number): MarketActivityRow {
    const categoryFilter = categories.length > 0
      ? `AND s.category IN (${categories.map(() => '?').join(',')})`
      : ''

    // New listings
    const newListings = this.db.prepare(`
      SELECT s.id, s.title, s.category, s.price, s.created_at
      FROM skills s
      WHERE s.status = 'active' AND s.created_at > ? ${categoryFilter}
      ORDER BY s.created_at DESC
      LIMIT 20
    `).all(sinceTimestamp, ...categories) as {
      id: string; title: string; category: string; price: string; created_at: number
    }[]

    // New bounties
    const bountyFilter = categories.length > 0
      ? `AND category IN (${categories.map(() => '?').join(',')})`
      : ''

    const newBounties = this.db.prepare(`
      SELECT id, title, category, reward_amount, created_at
      FROM bounties
      WHERE status = 'open' AND created_at > ? ${bountyFilter}
      ORDER BY created_at DESC
      LIMIT 20
    `).all(sinceTimestamp, ...categories) as {
      id: string; title: string; category: string; reward_amount: string; created_at: number
    }[]

    // Recent completed sales
    const recentSales = this.db.prepare(`
      SELECT e.id, e.amount, e.claimed_at, s.category, s.title
      FROM escrows e
      JOIN skills s ON e.skill_id = s.id
      WHERE e.completed = 1 AND e.claimed_at > ? ${categoryFilter}
      ORDER BY e.claimed_at DESC
      LIMIT 20
    `).all(sinceTimestamp, ...categories) as {
      id: number; amount: string; claimed_at: number; category: string; title: string
    }[]

    return {
      new_listings: newListings,
      new_bounties: newBounties,
      recent_sales: recentSales,
    }
  }

  searchBounties(opts: {
    category?: string
    tags?: string[]
    minReward?: string
    maxReward?: string
    sort?: 'newest' | 'reward' | 'expiring'
    limit?: number
    offset?: number
  }): BountyRow[] {
    const conditions: string[] = ["status = 'open'"]
    const values: unknown[] = []

    if (opts.category) {
      conditions.push('category = ?')
      values.push(opts.category)
    }

    if (opts.minReward) {
      conditions.push('CAST(reward_amount AS INTEGER) >= ?')
      values.push(parseInt(opts.minReward, 10))
    }

    if (opts.maxReward) {
      conditions.push('CAST(reward_amount AS INTEGER) <= ?')
      values.push(parseInt(opts.maxReward, 10))
    }

    if (opts.tags && opts.tags.length > 0) {
      // Match any of the provided tags
      const tagConditions = opts.tags.map(() => "tags LIKE ?")
      conditions.push(`(${tagConditions.join(' OR ')})`)
      opts.tags.forEach(tag => values.push(`%"${tag}"%`))
    }

    const where = `WHERE ${conditions.join(' AND ')}`

    let orderBy = 'ORDER BY created_at DESC'
    if (opts.sort === 'reward') {
      orderBy = 'ORDER BY CAST(reward_amount AS INTEGER) DESC'
    } else if (opts.sort === 'expiring') {
      orderBy = 'ORDER BY expires_at ASC'
    }

    const limit = opts.limit ?? 50
    const offset = opts.offset ?? 0

    return this.db.prepare(
      `SELECT * FROM bounties ${where} ${orderBy} LIMIT ? OFFSET ?`
    ).all(...values, limit, offset) as BountyRow[]
  }
}

// Row types
export interface MarketSummaryRow {
  total_escrows: number
  active_listings: number
  open_bounties: number
  total_volume: string
  volume_period: string
  total_completed: number
  is_early_network: boolean
  top_categories: { category: string; escrow_count: number; volume: string }[]
  trending_categories: string[]
  underserved_categories: { category: string; bounty_count: number; listing_count: number }[]
}

export interface CategoryPricingRow {
  category: string
  min_price: string | null
  max_price: string | null
  avg_price: string | null
  median_price: string | null
  sample_size: number
  insufficient_data: boolean
  demand_score: number
}

export interface MarketActivityRow {
  new_listings: { id: string; title: string; category: string; price: string; created_at: number }[]
  new_bounties: { id: string; title: string; category: string; reward_amount: string; created_at: number }[]
  recent_sales: { id: number; amount: string; claimed_at: number; category: string; title: string }[]
}

// Row types
export interface EscrowRow {
  id: number
  chain_id: number
  seller: string
  buyer: string
  payment_token: string
  seller_agent_id: number
  buyer_agent_id: number
  amount: string
  content_hash: string
  dispute_window: number
  state: string
  created_at: number
  funded_at: number | null
  committed_at: number | null
  released_at: number | null
  claimed_at: number | null
  expired_at: number | null
  cancelled_at: number | null
  disputed_at: number | null
  resolved_at: number | null
  time_to_fund: number | null
  time_to_release: number | null
  time_to_claim: number | null
  completed: number
  disputed: number
  dispute_outcome: string | null
  skill_id: string
}

export interface AgentReputationRow {
  agent_id: number
  total_created: number
  total_funded: number
  total_completed: number
  total_disputed: number
  total_cancelled: number
  total_volume: string
  volume_30d: string
  completion_rate: number
  dispute_rate: number
  cancellation_rate: number
  reputation_score: number
  first_escrow_at: number | null
  last_escrow_at: number | null
}

export interface WalletReputationRow {
  address: string
  role: string
  total_created: number
  total_funded: number
  total_completed: number
  total_disputed: number
  total_cancelled: number
  total_volume: string
  volume_30d: string
  completion_rate: number
  dispute_rate: number
  cancellation_rate: number
  reputation_score: number
  avg_delivery_seconds: number | null
  first_escrow_at: number | null
  last_escrow_at: number | null
}

export interface BountyRow {
  id: string
  poster: string
  poster_agent_id: number
  title: string
  description: string
  category: string
  reward_amount: string
  reward_token: string
  tags: string
  status: string
  escrow_id: number | null
  moltbook_post_id: string | null
  created_at: number
  expires_at: number
  fulfilled_at: number | null
  cancelled_at: number | null
}

export interface SkillRow {
  id: string
  seller: string
  seller_agent_id: number
  title: string
  description: string
  long_description: string
  category: string
  price: string
  price_token: string
  tags: string
  delivery: string
  content_hash: string
  encrypted_data_ref: string
  escrow_id: number | null
  status: string
  total_sales: number
  avg_rating: number
  created_at: number
}

export interface EscrowEventRow {
  id: number
  chain_id: number
  tx_hash: string
  log_index: number
  block_number: number
  block_timestamp: number
  escrow_id: number
  event_type: string
  event_data: string
  created_at: string
}

export interface CommentRow {
  id: number
  author: string
  author_agent_id: number
  target_type: string
  target_id: string
  body: string
  created_at: number
}

export interface ProtocolStatsRow {
  total_escrows: number
  total_funded: number
  total_completed: number
  total_disputed: number
  total_volume: string
  volume_30d: string
  unique_sellers: number
  unique_buyers: number
  unique_agents: number
  total_bounties: number
  total_bounties_fulfilled: number
}
