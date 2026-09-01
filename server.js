require("dotenv").config();

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const { Pool } = require("pg");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json());

const pool = new Pool({
connectionString: process.env.DATABASE_URL,
ssl: { rejectUnauthorized: false }
});

const TASKS = {
community: 25,
updates: 20,
invite3: 50,
game1: 100,
level5: 250,
daily: 10,
mine: 5
};

const MAX_MINING_SECONDS = 24 * 60 * 60;

// Telegram verification
function verify(initData) {

if (!initData || !process.env.TELEGRAM_BOT_TOKEN) {
throw Error("Missing Telegram configuration");
}

const p = new URLSearchParams(initData);
const hash = p.get("hash");

p.delete("hash");

const s = [...p.entries()]
.sort()
.map(([k, v]) => "${k}=${v}")
.join("\n");

const secret = crypto
.createHash("sha256")
.update(process.env.TELEGRAM_BOT_TOKEN)
.digest();

const expected = crypto
.createHmac("sha256", secret)
.update(s)
.digest("hex");

if (hash !== expected) {
throw Error("Invalid Telegram signature");
}

if (
Date.now() / 1000 - Number(p.get("auth_date")) >
86400
) {
throw Error("Expired Telegram data");
}

return JSON.parse(p.get("user") || "{}");
}

// Authenticate Telegram user
async function auth(req) {

const u = verify(
req.headers["x-telegram-init-data"]
);

if (!u.id) {
throw Error("Telegram user missing");
}

await pool.query(
"INSERT INTO users (telegram_id, username, first_name) VALUES($1, $2, $3) ON CONFLICT(telegram_id) DO UPDATE SET username = EXCLUDED.username, first_name = EXCLUDED.first_name, last_seen_at = NOW()",
[
u.id,
u.username || null,
u.first_name || null
]
);

return u;
}

// Health check
app.get("/health", (_, res) => {
res.json({ ok: true });
});

// User data
app.get("/api/me", async (req, res) => {

try {

const u = await auth(req);

const r = await pool.query(
  `SELECT *
   FROM users
   WHERE telegram_id=$1`,
  [u.id]
);

res.json(r.rows[0]);

} catch (e) {

console.error(e);

res.status(401).json({
  error: e.message
});

}

});

// START MINING
app.post("/api/mining/start", async (req, res) => {

try {

const u = await auth(req);

const r = await pool.query(
  `SELECT mining_started_at
   FROM users
   WHERE telegram_id=$1`,
  [u.id]
);

const user = r.rows[0];

// Already mining
if (user?.mining_started_at) {

  const elapsed =
    (Date.now() -
      new Date(user.mining_started_at).getTime()) /
    1000;

  // Still inside 24 hour session
  if (elapsed < MAX_MINING_SECONDS) {

    return res.json({
      ok: true,
      alreadyMining: true,
      mining_started_at:
        user.mining_started_at
    });

  }

  // Old session expired.
  // Give no automatic reward here.
  await pool.query(
    `UPDATE users
     SET mining_started_at=NULL
     WHERE telegram_id=$1`,
    [u.id]
  );
}

// Start a fresh 24 hour session
const result = await pool.query(
  `UPDATE users
   SET mining_started_at=NOW()
   WHERE telegram_id=$1
   RETURNING mining_started_at`,
  [u.id]
);

res.json({
  ok: true,
  mining_started_at:
    result.rows[0].mining_started_at
});

} catch (e) {

console.error(e);

res.status(401).json({
  error: e.message
});

}

});

// STOP MINING
app.post("/api/mining/stop", async (req, res) => {

try {

const u = await auth(req);

const c = await pool.connect();

try {

  await c.query("BEGIN");

  const r = await c.query(
    `SELECT balance, mining_started_at
     FROM users
     WHERE telegram_id=$1
     FOR UPDATE`,
    [u.id]
  );

  const user = r.rows[0];

  if (!user) {
    throw Error("User not found");
  }

  let reward = 0;

  if (user.mining_started_at) {

    const elapsedSeconds =
      Math.max(
        0,
        (Date.now() -
          new Date(
            user.mining_started_at
          ).getTime()) / 1000
      );

    // IMPORTANT:
    // Maximum mining time = 24 hours
    const miningSeconds =
      Math.min(
        elapsedSeconds,
        MAX_MINING_SECONDS
      );

    // Server-side reward calculation
    // 0.25 BHM per hour
    reward =
      miningSeconds * 0.25 / 3600;

    await c.query(
      `UPDATE users
       SET
         balance=balance+$1,
         mining_started_at=NULL
       WHERE telegram_id=$2`,
      [
        reward,
        u.id
      ]
    );

  }

  await c.query("COMMIT");

  res.json({
    ok: true,
    reward: Number(reward.toFixed(8))
  });

} catch (e) {

  await c.query("ROLLBACK");
  throw e;

} finally {

  c.release();

}

} catch (e) {

console.error(e);

res.status(401).json({
  error: e.message
});

}

});

// CLAIM TASK
app.post("/api/tasks/:id/claim", async (req, res) => {

try {

const u = await auth(req);

const taskId = req.params.id;
const reward = TASKS[taskId];

if (!reward) {

  return res.status(404).json({
    error: "Unknown task"
  });

}

const c = await pool.connect();

try {

  await c.query("BEGIN");

  // Lock/check task claim
  const old = await c.query(
    `SELECT 1
     FROM task_claims
     WHERE telegram_id=$1
     AND task_id=$2
     FOR UPDATE`,
    [
      u.id,
      taskId
    ]
  );

  if (old.rowCount) {

    await c.query("ROLLBACK");

    return res.status(409).json({
      error: "Already claimed"
    });

  }

  // Unique database record
  await c.query(
    `INSERT INTO task_claims
     (telegram_id, task_id)
     VALUES($1,$2)`,
    [
      u.id,
      taskId
    ]
  );

  // Add reward exactly once
  await c.query(
    `UPDATE users
     SET balance=balance+$1
     WHERE telegram_id=$2`,
    [
      reward,
      u.id
    ]
  );

  await c.query("COMMIT");

  res.json({
    ok: true,
    reward
  });

} catch (e) {

  await c.query("ROLLBACK");

  // PostgreSQL duplicate-key protection.
  // Even simultaneous requests cannot
  // credit the same task twice.
  if (e.code === "23505") {

    return res.status(409).json({
      error: "Already claimed"
    });

  }

  throw e;

} finally {

  c.release();

}

} catch (e) {

console.error(e);

res.status(401).json({
  error: e.message
});

}

});

// Leaderboard
app.get("/api/leaderboard", async (_, res) => {

try {

const result = await pool.query(
  `SELECT username, first_name, balance
   FROM users
   ORDER BY balance DESC
   LIMIT 20`
);

res.json(result.rows);

} catch (e) {

console.error(e);

res.status(500).json({
  error: "Database error"
});

}

});

// Serve index.html
app.get("/", (req, res) => {

res.sendFile(
path.join(__dirname, "index.html")
);

});

const PORT =
process.env.PORT || 10000;

app.listen(
PORT,
"0.0.0.0",
() => {
console.log(
"BharatMine server running on port ${PORT}"
);
}
);
