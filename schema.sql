CREATE TABLE IF NOT EXISTS users (
  telegram_id BIGINT PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  balance NUMERIC(20,8) NOT NULL DEFAULT 0,
  mining_started_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS task_claims (
  telegram_id BIGINT NOT NULL REFERENCES users(telegram_id) ON DELETE CASCADE,
  task_id TEXT NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (telegram_id, task_id)
);
CREATE TABLE IF NOT EXISTS referrals (
  invited_id BIGINT PRIMARY KEY REFERENCES users(telegram_id) ON DELETE CASCADE,
  inviter_id BIGINT NOT NULL REFERENCES users(telegram_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
