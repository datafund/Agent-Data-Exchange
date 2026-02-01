-- Agents API Database Schema

CREATE TABLE IF NOT EXISTS escrow_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chain_id INTEGER NOT NULL,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  block_number INTEGER NOT NULL,
  block_timestamp INTEGER NOT NULL,
  escrow_id INTEGER NOT NULL,
  event_type TEXT NOT NULL, -- created, funded, cancelled, claimed, expired, dispute_raised, seller_responded, dispute_resolved, emergency_withdrawal, key_committed, key_revealed
  event_data TEXT NOT NULL DEFAULT '{}', -- JSON blob
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(chain_id, tx_hash, log_index)
);

CREATE INDEX IF NOT EXISTS idx_events_escrow ON escrow_events(escrow_id);
CREATE INDEX IF NOT EXISTS idx_events_block ON escrow_events(chain_id, block_number);
CREATE INDEX IF NOT EXISTS idx_events_type ON escrow_events(event_type);

CREATE TABLE IF NOT EXISTS escrows (
  id INTEGER PRIMARY KEY, -- escrow_id from chain
  chain_id INTEGER NOT NULL,
  seller TEXT NOT NULL,
  buyer TEXT NOT NULL DEFAULT '',
  payment_token TEXT NOT NULL DEFAULT '',
  seller_agent_id INTEGER NOT NULL DEFAULT 0,
  buyer_agent_id INTEGER NOT NULL DEFAULT 0,
  amount TEXT NOT NULL DEFAULT '0', -- wei as string
  content_hash TEXT NOT NULL DEFAULT '',
  dispute_window INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'created', -- created, funded, key_committed, released, claimed, expired, cancelled, disputed, seller_responded, resolved_buyer, resolved_seller
  created_at INTEGER NOT NULL DEFAULT 0,
  funded_at INTEGER,
  committed_at INTEGER,
  released_at INTEGER,
  claimed_at INTEGER,
  expired_at INTEGER,
  cancelled_at INTEGER,
  disputed_at INTEGER,
  resolved_at INTEGER,
  time_to_fund INTEGER, -- seconds from created to funded
  time_to_release INTEGER, -- seconds from funded to released
  time_to_claim INTEGER, -- seconds from released to claimed
  completed INTEGER NOT NULL DEFAULT 0,
  disputed INTEGER NOT NULL DEFAULT 0,
  dispute_outcome TEXT, -- seller_wins, buyer_wins
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_escrows_seller ON escrows(seller);
CREATE INDEX IF NOT EXISTS idx_escrows_buyer ON escrows(buyer);
CREATE INDEX IF NOT EXISTS idx_escrows_seller_agent ON escrows(seller_agent_id);
CREATE INDEX IF NOT EXISTS idx_escrows_buyer_agent ON escrows(buyer_agent_id);
CREATE INDEX IF NOT EXISTS idx_escrows_state ON escrows(state);

CREATE TABLE IF NOT EXISTS agent_reputation (
  agent_id INTEGER PRIMARY KEY,
  total_created INTEGER NOT NULL DEFAULT 0,
  total_funded INTEGER NOT NULL DEFAULT 0,
  total_completed INTEGER NOT NULL DEFAULT 0,
  total_disputed INTEGER NOT NULL DEFAULT 0,
  total_cancelled INTEGER NOT NULL DEFAULT 0,
  total_volume TEXT NOT NULL DEFAULT '0', -- wei as string
  volume_30d TEXT NOT NULL DEFAULT '0',
  completion_rate INTEGER NOT NULL DEFAULT 0, -- 0-10000 (basis points)
  dispute_rate INTEGER NOT NULL DEFAULT 0,
  cancellation_rate INTEGER NOT NULL DEFAULT 0,
  reputation_score INTEGER NOT NULL DEFAULT 500, -- 0-1000
  first_escrow_at INTEGER,
  last_escrow_at INTEGER,
  last_updated TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wallet_reputation (
  address TEXT NOT NULL,
  role TEXT NOT NULL, -- seller, buyer
  total_created INTEGER NOT NULL DEFAULT 0,
  total_funded INTEGER NOT NULL DEFAULT 0,
  total_completed INTEGER NOT NULL DEFAULT 0,
  total_disputed INTEGER NOT NULL DEFAULT 0,
  total_cancelled INTEGER NOT NULL DEFAULT 0,
  total_volume TEXT NOT NULL DEFAULT '0',
  volume_30d TEXT NOT NULL DEFAULT '0',
  completion_rate INTEGER NOT NULL DEFAULT 0,
  dispute_rate INTEGER NOT NULL DEFAULT 0,
  cancellation_rate INTEGER NOT NULL DEFAULT 0,
  reputation_score INTEGER NOT NULL DEFAULT 500,
  avg_delivery_seconds INTEGER,
  first_escrow_at INTEGER,
  last_escrow_at INTEGER,
  last_updated TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (address, role)
);

CREATE TABLE IF NOT EXISTS protocol_stats (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  total_escrows INTEGER NOT NULL DEFAULT 0,
  total_funded INTEGER NOT NULL DEFAULT 0,
  total_completed INTEGER NOT NULL DEFAULT 0,
  total_disputed INTEGER NOT NULL DEFAULT 0,
  total_volume TEXT NOT NULL DEFAULT '0',
  volume_30d TEXT NOT NULL DEFAULT '0',
  unique_sellers INTEGER NOT NULL DEFAULT 0,
  unique_buyers INTEGER NOT NULL DEFAULT 0,
  unique_agents INTEGER NOT NULL DEFAULT 0,
  total_bounties INTEGER NOT NULL DEFAULT 0,
  total_bounties_fulfilled INTEGER NOT NULL DEFAULT 0,
  last_updated TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO protocol_stats (id) VALUES (1);

CREATE TABLE IF NOT EXISTS bounties (
  id TEXT PRIMARY KEY, -- uuid
  poster TEXT NOT NULL,
  poster_agent_id INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  reward_amount TEXT NOT NULL DEFAULT '0',
  reward_token TEXT NOT NULL DEFAULT 'USDC',
  tags TEXT NOT NULL DEFAULT '[]', -- JSON array
  status TEXT NOT NULL DEFAULT 'open', -- open, fulfilled, expired, cancelled
  escrow_id INTEGER, -- linked when fulfilled
  moltbook_post_id TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  fulfilled_at INTEGER,
  cancelled_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_bounties_poster ON bounties(poster);
CREATE INDEX IF NOT EXISTS idx_bounties_status ON bounties(status);
CREATE INDEX IF NOT EXISTS idx_bounties_category ON bounties(category);
CREATE INDEX IF NOT EXISTS idx_bounties_expires ON bounties(expires_at);

CREATE TABLE IF NOT EXISTS monitor_state (
  chain_id INTEGER PRIMARY KEY,
  last_block INTEGER NOT NULL DEFAULT 0,
  last_updated TEXT NOT NULL DEFAULT (datetime('now'))
);
