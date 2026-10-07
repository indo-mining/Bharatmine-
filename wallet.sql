CREATE TABLE IF NOT EXISTS wallet_connections (
  telegram_id BIGINT PRIMARY KEY
    REFERENCES users(telegram_id)
    ON DELETE CASCADE,

  wallet_address TEXT NOT NULL,

  chain_id INTEGER NOT NULL DEFAULT 56,

  verified BOOLEAN NOT NULL DEFAULT FALSE,

  nonce TEXT,

  nonce_expires_at TIMESTAMPTZ,

  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


CREATE UNIQUE INDEX IF NOT EXISTS
wallet_connections_address_unique
ON wallet_connections (LOWER(wallet_address));


CREATE INDEX IF NOT EXISTS
wallet_connections_verified_idx
ON wallet_connections (verified);
