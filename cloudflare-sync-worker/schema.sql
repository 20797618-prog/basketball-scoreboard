CREATE TABLE IF NOT EXISTS athletes (
  sync_code TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  is_deleted INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (sync_code, id)
);

CREATE TABLE IF NOT EXISTS matches (
  sync_code TEXT NOT NULL,
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  finished_at INTEGER,
  PRIMARY KEY (sync_code, id)
);

CREATE TABLE IF NOT EXISTS match_players (
  sync_code TEXT NOT NULL,
  id TEXT NOT NULL,
  match_id TEXT NOT NULL,
  athlete_id TEXT NOT NULL,
  join_order INTEGER NOT NULL,
  PRIMARY KEY (sync_code, id)
);

CREATE TABLE IF NOT EXISTS rounds (
  sync_code TEXT NOT NULL,
  id TEXT NOT NULL,
  match_id TEXT NOT NULL,
  round_no INTEGER NOT NULL,
  phase TEXT NOT NULL,
  overtime_seq INTEGER NOT NULL,
  parent_round_id TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (sync_code, id)
);

CREATE TABLE IF NOT EXISTS round_stats (
  sync_code TEXT NOT NULL,
  id TEXT NOT NULL,
  round_id TEXT NOT NULL,
  match_id TEXT NOT NULL,
  athlete_id TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  hits INTEGER NOT NULL,
  hit_rate REAL NOT NULL,
  rank_group TEXT NOT NULL,
  point_delta INTEGER NOT NULL,
  cola_delta INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (sync_code, id)
);

CREATE TABLE IF NOT EXISTS cola_ledger (
  sync_code TEXT NOT NULL,
  id TEXT NOT NULL,
  type TEXT NOT NULL,
  from_athlete_id TEXT,
  to_athlete_id TEXT,
  amount INTEGER NOT NULL,
  match_id TEXT,
  round_id TEXT,
  note TEXT,
  created_at INTEGER NOT NULL,
  operator TEXT NOT NULL,
  PRIMARY KEY (sync_code, id)
);

-- 球员认领：把球员绑定到登录邮箱
CREATE TABLE IF NOT EXISTS athlete_claims (
  sync_code TEXT NOT NULL,
  athlete_id TEXT NOT NULL,
  claim_code TEXT NOT NULL,
  claimed_by TEXT,
  claimed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (sync_code, athlete_id)
);

-- 可乐转让申请（待对方确认后才写入 cola_ledger）
CREATE TABLE IF NOT EXISTS cola_transfers (
  sync_code TEXT NOT NULL,
  id TEXT NOT NULL,
  from_athlete_id TEXT NOT NULL,
  to_athlete_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  note TEXT,
  status TEXT NOT NULL,
  created_by_email TEXT NOT NULL,
  decided_by_email TEXT,
  created_at INTEGER NOT NULL,
  decided_at INTEGER,
  PRIMARY KEY (sync_code, id)
);

CREATE INDEX IF NOT EXISTS idx_athletes_sync_code ON athletes(sync_code);CREATE INDEX IF NOT EXISTS idx_matches_sync_code ON matches(sync_code);
CREATE INDEX IF NOT EXISTS idx_match_players_sync_code ON match_players(sync_code);
CREATE INDEX IF NOT EXISTS idx_rounds_sync_code ON rounds(sync_code);
CREATE INDEX IF NOT EXISTS idx_round_stats_sync_code ON round_stats(sync_code);
CREATE INDEX IF NOT EXISTS idx_cola_ledger_sync_code ON cola_ledger(sync_code);
CREATE INDEX IF NOT EXISTS idx_athlete_claims_sync_code ON athlete_claims(sync_code);
CREATE INDEX IF NOT EXISTS idx_cola_transfers_sync_code ON cola_transfers(sync_code);

-- 微信身份桥：WorkBuddy 的 uid ↔ 本站邮箱账号（首次绑定一次，之后微信扫码直接进）
-- 注意：wb_uid 全局唯一，因此不带 sync_code 前缀。
CREATE TABLE IF NOT EXISTS wb_bindings (
  wb_uid TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (wb_uid)
);

CREATE INDEX IF NOT EXISTS idx_wb_bindings_email ON wb_bindings(email);
