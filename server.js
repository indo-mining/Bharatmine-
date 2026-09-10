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

// =========================================
// BHARATMINE ECONOMY
// =========================================

const TASKS = {
  instagram: 2,
  youtube: 2,
  bot: 1,
  invite3: 5,
  game1: 5,
  level5: 10
};

// Mining rate
// 0.001 BHM per minute
const MINING_RATE_PER_MINUTE = 0.001;

// Maximum mining session = 24 hours
const MAX_MINING_SECONDS = 24 * 60 * 60;

// Daily Code reward
const DAILY_CODE_REWARD = 2;

// =========================================
// REFERRAL SYSTEM
// =========================================

const REFERRAL_BASE_REWARD = 5;

const REFERRAL_MILESTONES = [
  { count: 3, reward: 15 },
  { count: 10, reward: 50 },
  { count: 25, reward: 150 },
  { count: 50, reward: 350 },
  { count: 100, reward: 800 }
];

// =========================================
// TASK LINKS
// =========================================

const TASK_LINKS = {
  instagram: "https://www.instagram.com/bharatmine.in",
  youtube: "https://youtube.com/@bharatmine-in",
  bot: "https://t.me/BharatMineBot"
};

// =========================================
// DAILY CODE
// =========================================

function getIndiaDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function getDailySecret() {
  return (
    process.env.DAILY_CODE_SECRET ||
    process.env.TELEGRAM_BOT_TOKEN
  );
}

function generateDailyCode(date) {
  const secret = getDailySecret();

  if (!secret) {
    throw new Error("Daily code secret missing");
  }

  const hash = crypto
    .createHmac("sha256", secret)
    .update(`BharatMine-Daily-Code:${date}`)
    .digest("hex")
    .toUpperCase();

  return `BHM-${hash.substring(0, 6)}`;
}

// =========================================
// TELEGRAM MINI APP VERIFICATION
// =========================================

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

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(process.env.TELEGRAM_BOT_TOKEN)
    .digest();

  const calculatedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (
    receivedHash.length !== calculatedHash.length ||
    !crypto.timingSafeEqual(
      Buffer.from(receivedHash),
      Buffer.from(calculatedHash)
    )
  ) {
    throw new Error("Invalid Telegram signature");
  }

  const authDate = Number(params.get("auth_date"));

  if (!authDate || !Number.isFinite(authDate)) {
    throw new Error("Invalid Telegram auth date");
  }

  const age = Date.now() / 1000 - authDate;

  if (age > 86400) {
    throw new Error("Expired Telegram data");
  }

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

  if (!user.id) {
    throw new Error("Telegram user ID missing");
  }

  return {
    user,
    params
  };
}

// =========================================
// REWARD FROM POOL
// =========================================

async function rewardFromPool(
  client,
  poolName,
  userId,
  amount
) {
  const reward = Number(amount);

  if (!Number.isFinite(reward) || reward <= 0) {
    throw new Error("Invalid reward");
  }

  const poolResult = await client.query(
    `
    SELECT remaining
    FROM reward_pools
    WHERE pool_name = $1
    FOR UPDATE
    `,
    [poolName]
  );

  if (!poolResult.rows.length) {
    throw new Error(
      `Reward pool '${poolName}' not found`
    );
  }

  const remaining =
    Number(poolResult.rows[0].remaining);

  if (remaining < reward) {
    throw new Error("Reward pool exhausted");
  }

  await client.query(
    `
    UPDATE reward_pools
    SET
      remaining = remaining - $1,
      updated_at = NOW()
    WHERE pool_name = $2
    `,
    [reward, poolName]
  );

  await client.query(
    `
    UPDATE users
    SET balance = balance + $1
    WHERE telegram_id = $2
    `,
    [reward, userId]
  );
}

// =========================================
// AUTH + REFERRAL
// =========================================

async function auth(req) {
  const initData =
    req.headers["x-telegram-init-data"];

  const verified = verify(initData);

  const user = verified.user;
  const params = verified.params;

  // Telegram Mini App start parameter
  const startParam =
    params.get("start_param") || "";

  const client =
    await pool.connect();

  try {
    await client.query("BEGIN");

    // Check whether user already exists
    const existing =
      await client.query(
        `
        SELECT telegram_id
        FROM users
        WHERE telegram_id = $1
        FOR UPDATE
        `,
        [user.id]
      );

    const isNewUser =
      existing.rowCount === 0;

    // =====================================
    // CREATE / UPDATE USER
    // =====================================

    await client.query(
      `
      INSERT INTO users
        (
          telegram_id,
          username,
          first_name,
          last_seen_at
        )

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

    // =====================================
    // REFERRAL PROCESS
    // ONLY NEW USERS
    // =====================================

    if (
      isNewUser &&
      startParam
    ) {
      let inviterId = null;

      // Expected format:
      // ref_123456789

      if (
        startParam.startsWith("ref_")
      ) {
        inviterId =
          startParam.substring(4);
      }

      // Validate inviter ID
      if (
        inviterId &&
        /^\d+$/.test(inviterId) &&
        String(inviterId) !== String(user.id)
      ) {

        // Check inviter exists
        const inviter =
          await client.query(
            `
            SELECT telegram_id
            FROM users
            WHERE telegram_id = $1
            FOR UPDATE
            `,
            [inviterId]
          );

        if (
          inviter.rowCount > 0
        ) {

          // Save referral
          const referral =
            await client.query(
              `
              INSERT INTO referrals
                (
                  invited_id,
                  inviter_id
                )

              VALUES
                ($1, $2)

              ON CONFLICT (invited_id)
              DO NOTHING

              RETURNING invited_id
              `,
              [
                user.id,
                inviterId
              ]
            );

          // =================================
          // NEW REFERRAL SUCCESSFULLY CREATED
          // =================================

          if (
            referral.rowCount > 0
          ) {

            // Base reward
            await rewardFromPool(
              client,
              "referrals",
              inviterId,
              REFERRAL_BASE_REWARD
            );

            // Count referrals
            const countResult =
              await client.query(
                `
                SELECT
                  COUNT(*)::INTEGER AS count
                FROM referrals
                WHERE inviter_id = $1
                `,
                [inviterId]
              );

            const referralCount =
              Number(
                countResult.rows[0].count
              );

            // =================================
            // MILESTONE REWARDS
            // =================================

            for (
              const milestone
              of REFERRAL_MILESTONES
            ) {

              if (
                referralCount >=
                milestone.count
              ) {

                const milestoneInsert =
                  await client.query(
                    `
                    INSERT INTO referral_rewards
                      (
                        telegram_id,
                        milestone,
                        reward
                      )

                    VALUES
                      ($1, $2, $3)

                    ON CONFLICT
                      (telegram_id, milestone)
                    DO NOTHING

                    RETURNING milestone
                    `,
                    [
                      inviterId,
                      milestone.count,
                      milestone.reward
                    ]
                  );

                // Give milestone reward only once
                if (
                  milestoneInsert.rowCount > 0
                ) {

                  await rewardFromPool(
                    client,
                    "referrals",
                    inviterId,
                    milestone.reward
                  );
                }
              }
            }
          }
        }
      }
    }

    await client.query("COMMIT");

    return user;

  } catch (error) {

    await client.query("ROLLBACK");

    throw error;

  } finally {

    client.release();
  }
}

// =========================================
// AUTO COMPLETE MINING
// =========================================
// 24 hours complete hone par reward automatically
// balance me add hota hai.

async function settleCompletedMining(userId) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `
      SELECT
        balance,
        mining_started_at
      FROM users
      WHERE telegram_id = $1
      FOR UPDATE
      `,
      [userId]
    );

    const dbUser = result.rows[0];

    if (!dbUser) {
      throw new Error("User not found");
    }

    if (!dbUser.mining_started_at) {
      await client.query("COMMIT");

      return {
        mining: false,
        completed: false,
        reward: 0,
        balance: Number(
          dbUser.balance || 0
        )
      };
    }

    const startedAt =
      new Date(
        dbUser.mining_started_at
      ).getTime();

    const elapsedSeconds =
      Math.max(
        0,
        (Date.now() - startedAt) / 1000
      );

    // Still mining
    if (
      elapsedSeconds <
      MAX_MINING_SECONDS
    ) {
      await client.query("COMMIT");

      return {
        mining: true,
        completed: false,
        reward: 0,
        balance: Number(
          dbUser.balance || 0
        ),
        mining_started_at:
          dbUser.mining_started_at,
        elapsed_seconds:
          Math.floor(elapsedSeconds),
        remaining_seconds:
          Math.ceil(
            MAX_MINING_SECONDS -
            elapsedSeconds
          )
      };
    }

    // =====================================
    // 24 HOURS COMPLETE
    // =====================================

    const reward =
      (MAX_MINING_SECONDS / 60) *
      MINING_RATE_PER_MINUTE;

    await rewardFromPool(
      client,
      "mining",
      userId,
      reward
    );

    await client.query(
      `
      UPDATE users
      SET mining_started_at = NULL
      WHERE telegram_id = $1
      `,
      [userId]
    );

    const updated =
      await client.query(
        `
        SELECT balance
        FROM users
        WHERE telegram_id = $1
        `,
        [userId]
      );

    await client.query("COMMIT");

    return {
      mining: false,
      completed: true,
      reward: Number(
        reward.toFixed(8)
      ),
      balance: Number(
        updated.rows[0].balance || 0
      )
    };

  } catch (error) {

    await client.query("ROLLBACK");

    throw error;

  } finally {

    client.release();
  }
}

// =========================================
// HEALTH
// =========================================

app.get("/health", async (req, res) => {
  try {

    await pool.query("SELECT 1");

    res.json({
      ok: true,
      service: "BharatMine"
    });

  } catch (error) {

    console.error(
      "HEALTH ERROR:",
      error
    );

    res.status(500).json({
      ok: false,
      error: "Database error"
    });
  }
});

// =========================================
// USER DATA
// =========================================

app.get("/api/me", async (req, res) => {
  try {

    const user = await auth(req);

    // Automatically settle completed mining
    const mining =
      await settleCompletedMining(user.id);

    const result = await pool.query(
      `
      SELECT
        telegram_id,
        username,
        first_name,
        balance,
        mining_started_at,
        created_at,
        last_seen_at
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

    // Normal claimed tasks
    const claims = await pool.query(
      `
      SELECT task_id
      FROM task_claims
      WHERE telegram_id = $1
      AND task_id NOT LIKE 'daily:%'
      `,
      [user.id]
    );

    // Today's daily claim
    const today = getIndiaDate();

    const dailyClaim = await pool.query(
      `
      SELECT 1
      FROM task_claims
      WHERE telegram_id = $1
      AND task_id = $2
      LIMIT 1
      `,
      [
        user.id,
        `daily:${today}`
      ]
    );

    const claimedTasks =
      claims.rows.map(
        row => row.task_id
      );

    if (dailyClaim.rowCount > 0) {
      claimedTasks.push("daily");
    }

    // Referral count
    const referralCountResult =
      await pool.query(
        `
        SELECT COUNT(*)::INTEGER AS count
        FROM referrals
        WHERE inviter_id = $1
        `,
        [user.id]
      );

    const referralCount =
      Number(
        referralCountResult.rows[0].count
      );

    res.json({
      ...result.rows[0],

      claimed_tasks:
        claimedTasks,

      referrals: {
        count: referralCount,
        reward_per_referral:
          REFERRAL_BASE_REWARD,
        referral_link:
          `https://t.me/BharatMineBot?start=ref_${user.id}`,
        milestones:
          REFERRAL_MILESTONES
      },

      mining_status: {
        mining:
          mining.mining,

        completed:
          mining.completed,

        reward:
          mining.reward,

        remaining_seconds:
          mining.remaining_seconds || 0
      }
    });

  } catch (error) {

    console.error(
      "ME ERROR:",
      error
    );

    res.status(401).json({
      error: error.message
    });
  }
});

// =========================================
// REFERRAL DETAILS
// =========================================

app.get(
  "/api/referrals",
  async (req, res) => {

    try {

      const user =
        await auth(req);

      const countResult =
        await pool.query(
          `
          SELECT COUNT(*)::INTEGER AS count
          FROM referrals
          WHERE inviter_id = $1
          `,
          [user.id]
        );

      const count =
        Number(
          countResult.rows[0].count
        );

      const referrals =
        await pool.query(
          `
          SELECT
            r.invited_id,
            u.username,
            u.first_name,
            r.created_at
          FROM referrals r
          LEFT JOIN users u
            ON u.telegram_id = r.invited_id
          WHERE r.inviter_id = $1
          ORDER BY r.created_at DESC
          `,
          [user.id]
        );

      const nextMilestone =
        REFERRAL_MILESTONES.find(
          item => count < item.count
        ) || null;

      res.json({
        ok: true,

        count,

        reward_per_referral:
          REFERRAL_BASE_REWARD,

        referral_link:
          `https://t.me/BharatMineBot?start=ref_${user.id}`,

        next_milestone:
          nextMilestone,

        milestones:
          REFERRAL_MILESTONES,

        referrals:
          referrals.rows
      });

    } catch (error) {

      console.error(
        "REFERRAL ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message
      });
    }
  }
);

// =========================================
// START MINING
// =========================================

app.post(
  "/api/mining/start",
  async (req, res) => {

    try {

      const user = await auth(req);

      // Check old session
      const current =
        await settleCompletedMining(
          user.id
        );

      // Already mining
      if (current.mining) {

        return res.json({
          ok: true,
          alreadyMining: true,
          mining: true,
          mining_started_at:
            current.mining_started_at,
          remaining_seconds:
            current.remaining_seconds
        });
      }

      const client =
        await pool.connect();

      try {

        await client.query("BEGIN");

        const result =
          await client.query(
            `
            SELECT mining_started_at
            FROM users
            WHERE telegram_id = $1
            FOR UPDATE
            `,
            [user.id]
          );

        const dbUser =
          result.rows[0];

        if (!dbUser) {
          throw new Error(
            "User not found"
          );
        }

        // Duplicate protection
        if (
          dbUser.mining_started_at
        ) {

          await client.query(
            "COMMIT"
          );

          return res.json({
            ok: true,
            alreadyMining: true,
            mining: true,
            mining_started_at:
              dbUser.mining_started_at
          });
        }

        const started =
          await client.query(
            `
            UPDATE users
            SET mining_started_at = NOW()
            WHERE telegram_id = $1
            RETURNING mining_started_at
            `,
            [user.id]
          );

        await client.query(
          "COMMIT"
        );

        res.json({
          ok: true,
          mining: true,
          mining_started_at:
            started.rows[0]
              .mining_started_at,
          rate_per_minute:
            MINING_RATE_PER_MINUTE,
          duration_seconds:
            MAX_MINING_SECONDS
        });

      } catch (error) {

        await client.query(
          "ROLLBACK"
        );

        throw error;

      } finally {

        client.release();
      }

    } catch (error) {

      console.error(
        "MINING START ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message
      });
    }
  }
);

// =========================================
// MINING STATUS
// =========================================

app.get(
  "/api/mining/status",
  async (req, res) => {

    try {

      const user = await auth(req);

      const mining =
        await settleCompletedMining(
          user.id
        );

      res.json({
        ok: true,

        mining:
          mining.mining,

        completed:
          mining.completed,

        reward:
          mining.reward,

        balance:
          mining.balance,

        mining_started_at:
          mining.mining_started_at || null,

        elapsed_seconds:
          mining.elapsed_seconds || 0,

        remaining_seconds:
          mining.remaining_seconds || 0,

        rate_per_minute:
          MINING_RATE_PER_MINUTE,

        duration_seconds:
          MAX_MINING_SECONDS
      });

    } catch (error) {

      console.error(
        "MINING STATUS ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message
      });
    }
  }
);

// =========================================
// TASK LINKS
// =========================================

app.get(
  "/api/tasks",
  (req, res) => {

    res.json({

      instagram: {
        title:
          "Follow BharatMine Instagram",
        url:
          TASK_LINKS.instagram,
        reward:
          TASKS.instagram
      },

      youtube: {
        title:
          "Subscribe BharatMine YouTube",
        url:
          TASK_LINKS.youtube,
        reward:
          TASKS.youtube
      },

      bot: {
        title:
          "Start BharatMine Bot",
        url:
          TASK_LINKS.bot,
        reward:
          TASKS.bot
      },

      invite3: {
        title:
          "Invite 3 Friends",
        reward:
          TASKS.invite3
      },

      game1: {
        title:
          "Complete Game Task",
        reward:
          TASKS.game1
      },

      level5: {
        title:
          "Reach Level 5",
        reward:
          TASKS.level5
      },

      daily: {
        title:
          "Daily Video Code",
        reward:
          DAILY_CODE_REWARD
      }

    });
  }
);

// =========================================
// CLAIM NORMAL TASK
// =========================================

app.post(
  "/api/tasks/:id/claim",
  async (req, res) => {

    try {

      const user = await auth(req);

      const taskId =
        req.params.id;

      if (taskId === "daily") {

        return res.status(400).json({
          error:
            "Daily task requires daily code"
        });
      }

      const reward =
        TASKS[taskId];

      if (reward === undefined) {

        return res.status(404).json({
          error:
            "Unknown task"
        });
      }

      const client =
        await pool.connect();

      try {

        await client.query(
          "BEGIN"
        );

        const existing =
          await client.query(
            `
            SELECT 1
            FROM task_claims
            WHERE telegram_id = $1
            AND task_id = $2
            LIMIT 1
            `,
            [
              user.id,
              taskId
            ]
          );

        if (
          existing.rowCount > 0
        ) {

          await client.query(
            "ROLLBACK"
          );

          return res.status(409).json({
            error:
              "Already claimed"
          });
        }

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

        await rewardFromPool(
          client,
          "tasks",
          user.id,
          reward
        );

        await client.query(
          "COMMIT"
        );

        res.json({
          ok: true,
          reward
        });

      } catch (error) {

        await client.query(
          "ROLLBACK"
        );

        if (
          error.code === "23505"
        ) {

          return res.status(409).json({
            error:
              "Already claimed"
          });
        }

        throw error;

      } finally {

        client.release();
      }

    } catch (error) {

      console.error(
        "TASK CLAIM ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message
      });
    }
  }
);

// =========================================
// DAILY CODE STATUS
// =========================================

app.get(
  "/api/daily",
  async (req, res) => {

    try {

      const user =
        await auth(req);

      const today =
        getIndiaDate();

      const result =
        await pool.query(
          `
          SELECT 1
          FROM task_claims
          WHERE telegram_id = $1
          AND task_id = $2
          LIMIT 1
          `,
          [
            user.id,
            `daily:${today}`
          ]
        );

      res.json({
        date: today,
        reward:
          DAILY_CODE_REWARD,
        claimed:
          result.rowCount > 0
      });

    } catch (error) {

      console.error(
        "DAILY STATUS ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message
      });
    }
  }
);

// =========================================
// DAILY CODE CLAIM
// =========================================

app.post(
  "/api/daily/claim",
  async (req, res) => {

    try {

      const user =
        await auth(req);

      const submittedCode =
        String(
          req.body.code || ""
        )
          .trim()
          .toUpperCase();

      if (!submittedCode) {

        return res.status(400).json({
          error:
            "Daily code required"
        });
      }

      const today =
        getIndiaDate();

      const correctCode =
        generateDailyCode(today);

      if (
        submittedCode !== correctCode
      ) {

        return res.status(400).json({
          error:
            "Invalid daily code"
        });
      }

      const taskId =
        `daily:${today}`;

      const client =
        await pool.connect();

      try {

        await client.query(
          "BEGIN"
        );

        const existing =
          await client.query(
            `
            SELECT 1
            FROM task_claims
            WHERE telegram_id = $1
            AND task_id = $2
            LIMIT 1
            `,
            [
              user.id,
              taskId
            ]
          );

        if (
          existing.rowCount > 0
        ) {

          await client.query(
            "ROLLBACK"
          );

          return res.status(409).json({
            error:
              "Already claimed"
          });
        }

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

        await rewardFromPool(
          client,
          "tasks",
          user.id,
          DAILY_CODE_REWARD
        );

        await client.query(
          "COMMIT"
        );

        res.json({
          ok: true,
          reward:
            DAILY_CODE_REWARD
        });

      } catch (error) {

        await client.query(
          "ROLLBACK"
        );

        if (
          error.code === "23505"
        ) {

          return res.status(409).json({
            error:
              "Already claimed"
          });
        }

        throw error;

      } finally {

        client.release();
      }

    } catch (error) {

      console.error(
        "DAILY CLAIM ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message
      });
    }
  }
);

// =========================================
// REWARD POOL STATUS
// =========================================

app.get(
  "/api/economy/pools",
  async (req, res) => {

    try {

      const result =
        await pool.query(
          `
          SELECT
            pool_name,
            allocated,
            remaining
          FROM reward_pools
          ORDER BY pool_name
          `
        );

      res.json(
        result.rows
      );

    } catch (error) {

      console.error(
        "POOL ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Economy error"
      });
    }
  }
);

// =========================================
// LEADERBOARD
// =========================================

app.get(
  "/api/leaderboard",
  async (req, res) => {

    try {

      const result =
        await pool.query(
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

      res.json(
        result.rows
      );

    } catch (error) {

      console.error(
        "LEADERBOARD ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Database error"
      });
    }
  }
);

// =========================================
// FRONTEND
// =========================================

app.use(express.static(__dirname));

// Frontend fallback
app.use((req, res, next) => {

  if (
    req.method !== "GET" &&
    req.method !== "HEAD"
  ) {
    return next();
  }

  res.sendFile(
    path.join(
      __dirname,
      "index.html"
    ),
    (err) => {

      if (err) {

        console.error(
          "FRONTEND ERROR:",
          err
        );

        if (!res.headersSent) {

          res.status(
            err.statusCode || 500
          ).json({
            error:
              "Frontend index.html not found"
          });
        }
      }
    }
  );
});

// =========================================
// SERVER
// =========================================

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
