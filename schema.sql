-- =========================================
-- BHARATMINE DATABASE
-- =========================================

CREATE TABLE IF NOT EXISTS users (
  telegram_id BIGINT PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  balance NUMERIC(20,8) NOT NULL DEFAULT 0,
  mining_started_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================================
-- NORMAL TASK CLAIMS
-- =========================================

CREATE TABLE IF NOT EXISTS task_claims (
  telegram_id BIGINT NOT NULL
    REFERENCES users(telegram_id) ON DELETE CASCADE,

  task_id TEXT NOT NULL,

  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (telegram_id, task_id)
);

-- =========================================
-- REFERRALS
-- =========================================

CREATE TABLE IF NOT EXISTS referrals (
  invited_id BIGINT PRIMARY KEY
    REFERENCES users(telegram_id) ON DELETE CASCADE,

  inviter_id BIGINT NOT NULL
    REFERENCES users(telegram_id) ON DELETE CASCADE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================================
-- REWARD POOLS
-- =========================================

CREATE TABLE IF NOT EXISTS reward_pools (
  pool_name TEXT PRIMARY KEY,

  allocated NUMERIC(20,8) NOT NULL,

  remaining NUMERIC(20,8) NOT NULL,

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================================
-- INITIAL 10 BILLION BHM ECONOMY
-- =========================================

INSERT INTO reward_pools
  (pool_name, allocated, remaining)
VALUES
  ('mining', 4000000000, 4000000000),
  ('tasks', 1000000000, 1000000000)
ON CONFLICT (pool_name) DO NOTHING;

-- =========================================
-- DAILY CLAIM INDEX
-- =========================================

CREATE INDEX IF NOT EXISTS idx_task_claims_user
ON task_claims(telegram_id);

CREATE INDEX IF NOT EXISTS idx_task_claims_task
ON task_claims(task_id);

CREATE INDEX IF NOT EXISTS idx_referrals_inviter
ON referrals(inviter_id);
