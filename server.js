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

// ===============================
// TASK REWARDS
// ===============================

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

// ===============================
// TELEGRAM MINI APP VERIFICATION
// ===============================

function verify(initData) {
  if (!initData) {
    throw new Error("Telegram init data missing");
  }

  if (!process.env.TELEGRAM_BOT_TOKEN) {
    throw new Error("Missing Telegram configuration");
  }

  const params = new URLSearchParams(initData);

  const receivedHash = params.get("hash");

  if (!receivedHash) {
    throw new Error("Telegram hash missing");
  }

  params.delete("hash");

  // Telegram requires the data-check-string
  // to be sorted alphabetically by key.
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  // Correct Telegram Mini App secret key:
  // HMAC-SHA256 with key "WebAppData"
  // and message = bot token.
  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(process.env.TELEGRAM_BOT_TOKEN)
    .digest();

  const calculatedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  // Timing-safe comparison
  if (
    receivedHash.length !== calculatedHash.length ||
    !crypto.timingSafeEqual(
      Buffer.from(receivedHash),
      Buffer.from(calculatedHash)
    )
  ) {
    throw new Error("Invalid Telegram signature");
  }

  // Check auth_date
  const authDate = Number(params.get("auth_date"));

  if (!authDate || !Number.isFinite(authDate)) {
    throw new Error("Invalid Telegram auth date");
  }

  const age = Date.now() / 1000 - authDate;

  // 24 hour validity
  if (age > 86400) {
    throw new Error("Expired Telegram data");
  }

  // Prevent obviously invalid future timestamps
  if (age < -60) {
    throw new Error("Invalid Telegram auth date");
  }

  const userString = params.get("user");

  if (!userString) {
    throw new Error("Telegram user missing");
  }

  let user;

  try {
    user = JSON.parse(userString);
  } catch {
    throw new Error("Invalid Telegram user data");
  }

  return user;
}

// ===============================
// AUTHENTICATE TELEGRAM USER
// ===============================

async function auth(req) {
  const initData = req.headers["x-telegram-init-data"];

  const user = verify(initData);

  if (!user.id) {
    throw new Error("Telegram user missing");
  }

  await pool.query(
    `
    INSERT INTO users
      (telegram_id, username, first_name, last_seen_at)
    VALUES
      ($1, $2, $3, NOW())
    ON CONFLICT (telegram_id)
    DO UPDATE SET
      username = EXCLUDED.username,
      first_name = EXCLUDED.first_name,
      last_seen_at = NOW()
    `,
    [
      user.id,
      user.username || null,
      user.first_name || null
    ]
  );

  return user;
}

// ===============================
// HEALTH CHECK
// ===============================

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "BharatMine"
  });
});

// ===============================
// USER DATA
// ===============================

app.get("/api/me", async (req, res) => {
  try {
    const user = await auth(req);

    const result = await pool.query(
      `
      SELECT *
      FROM users
      WHERE telegram_id = $1
      `,
      [user.id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({
        error: "User not found"
      });
    }

    res.json(result.rows[0]);

  } catch (error) {
    console.error("ME ERROR:", error);

    res.status(401).json({
      error: error.message
    });
  }
});

// ===============================
// START MINING
// ===============================

app.post("/api/mining/start", async (req, res) => {
  try {
    const user = await auth(req);

    const result = await pool.query(
      `
      SELECT mining_started_at
      FROM users
      WHERE telegram_id = $1
      `,
      [user.id]
    );

    const dbUser = result.rows[0];

    // Existing mining session
    if (dbUser && dbUser.mining_started_at) {
      const elapsed =
        (Date.now() -
          new Date(dbUser.mining_started_at).getTime()) /
        1000;

      // Still within 24 hours
      if (elapsed < MAX_MINING_SECONDS) {
        return res.json({
          ok: true,
          alreadyMining: true,
          mining_started_at: dbUser.mining_started_at
        });
      }

      // Old session expired.
      // Clear it first.
      await pool.query(
        `
        UPDATE users
        SET mining_started_at = NULL
        WHERE telegram_id = $1
        `,
        [user.id]
      );
    }

    // Start fresh mining session
    const started = await pool.query(
      `
      UPDATE users
      SET mining_started_at = NOW()
      WHERE telegram_id = $1
      RETURNING mining_started_at
      `,
      [user.id]
    );

    res.json({
      ok: true,
      mining_started_at:
        started.rows[0].mining_started_at
    });

  } catch (error) {
    console.error("MINING START ERROR:", error);

    res.status(401).json({
      error: error.message
    });
  }
});

// ===============================
// STOP / CLAIM MINING
// ===============================

app.post("/api/mining/stop", async (req, res) => {
  try {
    const user = await auth(req);

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const result = await client.query(
        `
        SELECT balance, mining_started_at
        FROM users
        WHERE telegram_id = $1
        FOR UPDATE
        `,
        [user.id]
      );

      const dbUser = result.rows[0];

      if (!dbUser) {
        throw new Error("User not found");
      }

      let reward = 0;

      if (dbUser.mining_started_at) {
        const elapsedSeconds = Math.max(
          0,
          (Date.now() -
            new Date(dbUser.mining_started_at).getTime()) /
            1000
        );

        // Maximum 24 hours
        const miningSeconds = Math.min(
          elapsedSeconds,
          MAX_MINING_SECONDS
        );

        // 0.25 BHM per hour
        reward =
          (miningSeconds * 0.25) / 3600;

        await client.query(
          `
          UPDATE users
          SET
            balance = balance + $1,
            mining_started_at = NULL
          WHERE telegram_id = $2
          `,
          [
            reward,
            user.id
          ]
        );
      }

      await client.query("COMMIT");

      res.json({
        ok: true,
        reward: Number(reward.toFixed(8))
      });

    } catch (error) {
      await client.query("ROLLBACK");
      throw error;

    } finally {
      client.release();
    }

  } catch (error) {
    console.error("MINING STOP ERROR:", error);

    res.status(401).json({
      error: error.message
    });
  }
});

// ===============================
// CLAIM TASK
// ===============================

app.post("/api/tasks/:id/claim", async (req, res) => {
  try {
    const user = await auth(req);

    const taskId = req.params.id;
    const reward = TASKS[taskId];

    if (reward === undefined) {
      return res.status(404).json({
        error: "Unknown task"
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // Check whether task was already claimed
      const existing = await client.query(
        `
        SELECT 1
        FROM task_claims
        WHERE telegram_id = $1
          AND task_id = $2
        FOR UPDATE
        `,
        [
          user.id,
          taskId
        ]
      );

      if (existing.rowCount > 0) {
        await client.query("ROLLBACK");

        return res.status(409).json({
          error: "Already claimed"
        });
      }

      // Insert claim record
      await client.query(
        `
        INSERT INTO task_claims
          (telegram_id, task_id)
        VALUES
          ($1, $2)
        `,
        [
          user.id,
          taskId
        ]
      );

      // Add reward
      await client.query(
        `
        UPDATE users
        SET balance = balance + $1
        WHERE telegram_id = $2
        `,
        [
          reward,
          user.id
        ]
      );

      await client.query("COMMIT");

      res.json({
        ok: true,
        reward
      });

    } catch (error) {
      await client.query("ROLLBACK");

      // Duplicate task claim
      if (error.code === "23505") {
        return res.status(409).json({
          error: "Already claimed"
        });
      }

      throw error;

    } finally {
      client.release();
    }

  } catch (error) {
    console.error("TASK CLAIM ERROR:", error);

    res.status(401).json({
      error: error.message
    });
  }
});

// ===============================
// LEADERBOARD
// ===============================

app.get("/api/leaderboard", async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        username,
        first_name,
        balance
      FROM users
      ORDER BY balance DESC
      LIMIT 20
      `
    );

    res.json(result.rows);

  } catch (error) {
    console.error("LEADERBOARD ERROR:", error);

    res.status(500).json({
      error: "Database error"
    });
  }
});

// ===============================
// SERVE FRONTEND
// ===============================

app.get("/", (req, res) => {
  res.sendFile(
    path.join(__dirname, "index.html")
  );
});

// ===============================
// SERVER
// ===============================

const PORT =
  process.env.PORT || 10000;

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `BharatMine server running on port ${PORT}`
    );
  }
);
