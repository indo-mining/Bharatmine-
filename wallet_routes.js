"use strict";

const crypto = require("crypto");
const { ethers } = require("ethers");

const BSC_CHAIN_ID = 56;

const NONCE_MINUTES = 5;

const TELEGRAM_MAX_AGE_SECONDS =
  24 * 60 * 60;


/* ==========================================
   HELPERS
========================================== */

function clean(value, max = 500) {
  return String(value ?? "")
    .trim()
    .slice(0, max);
}


function isEvmAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(
    String(value || "")
  );
}


function safeEqualHex(a, b) {

  try {

    const aa =
      Buffer.from(
        String(a),
        "hex"
      );

    const bb =
      Buffer.from(
        String(b),
        "hex"
      );

    return (
      aa.length === bb.length &&
      crypto.timingSafeEqual(
        aa,
        bb
      )
    );

  } catch {

    return false;

  }
}


/* ==========================================
   TELEGRAM WEB APP AUTH
========================================== */

function parseTelegramInitData(
  initData,
  botToken
) {

  if (
    !initData ||
    !botToken
  ) {
    return null;
  }


  const params =
    new URLSearchParams(
      initData
    );


  const receivedHash =
    params.get("hash");


  if (!receivedHash) {
    return null;
  }


  const pairs = [];


  for (
    const [
      key,
      value
    ] of params.entries()
  ) {

    if (
      key === "hash"
    ) {
      continue;
    }


    pairs.push(
      `${key}=${value}`
    );

  }


  pairs.sort();


  const dataCheckString =
    pairs.join("\n");


  const secretKey =
    crypto
      .createHmac(
        "sha256",
        "WebAppData"
      )
      .update(botToken)
      .digest();


  const calculatedHash =
    crypto
      .createHmac(
        "sha256",
        secretKey
      )
      .update(
        dataCheckString
      )
      .digest("hex");


  if (
    !safeEqualHex(
      calculatedHash,
      receivedHash
    )
  ) {

    return null;

  }


  const authDate =
    Number(
      params.get(
        "auth_date"
      ) || 0
    );


  if (!authDate) {
    return null;
  }


  const age =
    Math.floor(
      Date.now() / 1000
    ) - authDate;


  if (
    age >
    TELEGRAM_MAX_AGE_SECONDS
  ) {

    return null;

  }


  let user = null;


  try {

    user =
      JSON.parse(
        params.get("user") ||
        "null"
      );

  } catch {

    return null;

  }


  if (
    !user ||
    !user.id
  ) {

    return null;

  }


  return user;
}


/* ==========================================
   TELEGRAM AUTH MIDDLEWARE
========================================== */

function telegramMiddleware(
  botToken,
  pool
) {

  return async (
    req,
    res,
    next
  ) => {

    try {

      const initData =
        req.headers[
          "x-telegram-init-data"
        ] || "";


      const user =
        parseTelegramInitData(
          initData,
          botToken
        );


      if (!user) {

        return res
          .status(401)
          .json({
            ok: false,
            error:
              "Telegram authentication failed"
          });

      }


      await pool.query(
        `
        INSERT INTO users
        (
          telegram_id,
          username,
          first_name,
          last_seen_at
        )

        VALUES
        (
          $1,
          $2,
          $3,
          NOW()
        )

        ON CONFLICT
        (telegram_id)

        DO UPDATE SET
          username =
            EXCLUDED.username,

          first_name =
            EXCLUDED.first_name,

          last_seen_at =
            NOW()
        `,
        [
          Number(user.id),

          clean(
            user.username,
            100
          ) || null,

          clean(
            user.first_name,
            100
          ) || null
        ]
      );


      req.telegramUser =
        user;


      next();

    } catch (error) {

      console.error(
        "WALLET TELEGRAM AUTH ERROR:",
        error
      );


      return res
        .status(500)
        .json({
          ok: false,
          error:
            "Authentication error"
        });

    }

  };

}


/* ==========================================
   NONCE
========================================== */

function makeNonce() {

  return crypto
    .randomBytes(24)
    .toString("hex");

}


/* ==========================================
   SIGN MESSAGE
========================================== */

function makeWalletMessage(
  telegramId,
  address,
  nonce,
  expiresAt
) {

  return [
    "BharatMine Wallet Verification",
    "",
    `Telegram ID: ${telegramId}`,
    `Wallet: ${address}`,
    "Network: BNB Smart Chain (BSC)",
    "Chain ID: 56",
    `Nonce: ${nonce}`,
    `Expires: ${new Date(
      expiresAt
    ).toISOString()}`,
    "",
    "Sign this message to prove you control this wallet.",
    "No BHM or BNB transaction will be sent."
  ].join("\n");

}


/* ==========================================
   REGISTER WALLET ROUTES
========================================== */

function registerWalletRoutes(
  app,
  pool,
  botToken
) {

  if (
    !app ||
    !pool ||
    !botToken
  ) {

    throw new Error(
      "registerWalletRoutes requires app, pool and TELEGRAM_BOT_TOKEN"
    );

  }


  const auth =
    telegramMiddleware(
      botToken,
      pool
    );


  /* ========================================
     GET WALLET
  ======================================== */

  app.get(
    "/api/wallet",
    auth,
    async (
      req,
      res
    ) => {

      try {

        const r =
          await pool.query(
            `
            SELECT
              wallet_address,
              chain_id,
              verified,
              connected_at,
              updated_at

            FROM wallet_connections

            WHERE telegram_id=$1
            `,
            [
              Number(
                req.telegramUser.id
              )
            ]
          );


        if (!r.rowCount) {

          return res.json({
            ok: true,
            connected: false
          });

        }


        const row =
          r.rows[0];


        return res.json({

          ok: true,

          connected: true,

          wallet_address:
            row.wallet_address,

          chain_id:
            Number(
              row.chain_id
            ),

          verified:
            !!row.verified,

          connected_at:
            row.connected_at,

          updated_at:
            row.updated_at

        });

      } catch (error) {

        console.error(
          "GET WALLET ERROR:",
          error
        );


        return res
          .status(500)
          .json({
            ok: false,
            error:
              "Could not load wallet"
          });

      }

    }
  );


  /* ========================================
     CONNECT WALLET
  ======================================== */

  app.post(
    "/api/wallet/connect",
    auth,
    async (
      req,
      res
    ) => {

      try {

        const address =
          ethers.getAddress(
            clean(
              req.body.address,
              100
            )
          );


        const chainId =
          Number(
            req.body.chainId
          );


        if (
          !isEvmAddress(
            address
          )
        ) {

          return res
            .status(400)
            .json({
              ok: false,
              error:
                "Invalid wallet address"
            });

        }


        if (
          chainId !==
          BSC_CHAIN_ID
        ) {

          return res
            .status(400)
            .json({
              ok: false,
              error:
                "Please switch to BNB Smart Chain (BSC)"
            });

        }


        const existing =
          await pool.query(
            `
            SELECT
              telegram_id

            FROM wallet_connections

            WHERE LOWER(wallet_address)
              = LOWER($1)

            LIMIT 1
            `,
            [address]
          );


        if (
          existing.rowCount &&
          Number(
            existing.rows[0]
              .telegram_id
          ) !==
          Number(
            req.telegramUser.id
          )
        ) {

          return res
            .status(409)
            .json({
              ok: false,
              error:
                "This wallet is already linked to another BharatMine account"
            });

        }


        const r =
          await pool.query(
            `
            INSERT INTO wallet_connections
            (
              telegram_id,
              wallet_address,
              chain_id,
              verified,
              nonce,
              nonce_expires_at,
              connected_at,
              updated_at
            )

            VALUES
            (
              $1,
              $2,
              $3,
              FALSE,
              NULL,
              NULL,
              NOW(),
              NOW()
            )

            ON CONFLICT
            (telegram_id)

            DO UPDATE SET

              wallet_address =
                EXCLUDED.wallet_address,

              chain_id =
                EXCLUDED.chain_id,

              verified =
                CASE

                  WHEN
                    LOWER(
                      wallet_connections.wallet_address
                    )
                    =
                    LOWER(
                      EXCLUDED.wallet_address
                    )

                  THEN
                    wallet_connections.verified

                  ELSE
                    FALSE

                END,

              nonce =
                NULL,

              nonce_expires_at =
                NULL,

              updated_at =
                NOW()

            RETURNING
              wallet_address,
              chain_id,
              verified
            `,
            [
              Number(
                req.telegramUser.id
              ),

              address,

              BSC_CHAIN_ID
            ]
          );


        return res.json({

          ok: true,

          connected: true,

          wallet_address:
            r.rows[0]
              .wallet_address,

          chain_id:
            Number(
              r.rows[0].chain_id
            ),

          verified:
            !!r.rows[0].verified

        });

      } catch (error) {

        console.error(
          "CONNECT WALLET ERROR:",
          error
        );


        return res
          .status(400)
          .json({
            ok: false,
            error:
              "Wallet connection failed"
          });

      }

    }
  );


  /* ========================================
     CREATE NONCE
  ======================================== */

  app.post(
    "/api/wallet/nonce",
    auth,
    async (
      req,
      res
    ) => {

      try {

        const address =
          ethers.getAddress(
            clean(
              req.body.address,
              100
            )
          );


        const chainId =
          Number(
            req.body.chainId
          );


        if (
          !isEvmAddress(
            address
          )
        ) {

          return res
            .status(400)
            .json({
              ok: false,
              error:
                "Invalid wallet address"
            });

        }


        if (
          chainId !==
          BSC_CHAIN_ID
        ) {

          return res
            .status(400)
            .json({
              ok: false,
              error:
                "Please switch to BNB Smart Chain (BSC)"
            });

        }


        const existing =
          await pool.query(
            `
            SELECT
              wallet_address

            FROM wallet_connections

            WHERE telegram_id=$1
            `,
            [
              Number(
                req.telegramUser.id
              )
            ]
          );


        if (
          !existing.rowCount
        ) {

          return res
            .status(400)
            .json({
              ok: false,
              error:
                "Connect this wallet first"
            });

        }


        if (
          existing.rows[0]
            .wallet_address
            .toLowerCase() !==
          address.toLowerCase()
        ) {

          return res
            .status(400)
            .json({
              ok: false,
              error:
                "Wallet does not match"
            });

        }


        const nonce =
          makeNonce();


        const expiresAt =
          new Date(
            Date.now() +
            NONCE_MINUTES *
            60 *
            1000
          );


        const message =
          makeWalletMessage(
            req.telegramUser.id,
            address,
            nonce,
            expiresAt
          );


        await pool.query(
          `
          UPDATE wallet_connections

          SET
            nonce=$1,
            nonce_expires_at=$2,
            updated_at=NOW()

          WHERE telegram_id=$3
          `,
          [
            nonce,
            expiresAt,
            Number(
              req.telegramUser.id
            )
          ]
        );


        return res.json({

          ok: true,

          message,

          expires_at:
            expiresAt.toISOString()

        });

      } catch (error) {

        console.error(
          "WALLET NONCE ERROR:",
          error
        );


        return res
          .status(400)
          .json({
            ok: false,
            error:
              "Could not create verification request"
          });

      }

    }
  );


  /* ========================================
     VERIFY WALLET OWNERSHIP
  ======================================== */

  app.post(
    "/api/wallet/verify",
    auth,
    async (
      req,
      res
    ) => {

      try {

        const suppliedAddress =
          ethers.getAddress(
            clean(
              req.body.address,
              100
            )
          );


        const signature =
          clean(
            req.body.signature,
            1000
          );


        const chainId =
          Number(
            req.body.chainId
          );


        if (
          !isEvmAddress(
            suppliedAddress
          )
        ) {

          return res
            .status(400)
            .json({
              ok: false,
              error:
                "Invalid wallet address"
            });

        }


        if (
          chainId !==
          BSC_CHAIN_ID
        ) {

          return res
            .status(400)
            .json({
              ok: false,
              error:
                "Wrong network"
            });

        }


        if (!signature) {

          return res
            .status(400)
            .json({
              ok: false,
              error:
                "Signature missing"
            });

        }


        const r =
          await pool.query(
            `
            SELECT
              wallet_address,
              nonce,
              nonce_expires_at

            FROM wallet_connections

            WHERE telegram_id=$1
            `,
            [
              Number(
                req.telegramUser.id
              )
            ]
          );


        if (!r.rowCount) {

          return res
            .status(400)
            .json({
              ok: false,
              error:
                "Connect wallet first"
            });

        }


        const row =
          r.rows[0];


        if (
          row.wallet_address
            .toLowerCase() !==
          suppliedAddress
            .toLowerCase()
        ) {

          return res
            .status(400)
            .json({
              ok: false,
              error:
                "Wallet address does not match connected wallet"
            });

        }


        if (
          !row.nonce ||
          !row.nonce_expires_at
        ) {

          return res
            .status(400)
            .json({
              ok: false,
              error:
                "No active verification request"
            });

        }


        if (
          new Date(
            row.nonce_expires_at
          ).getTime() <
          Date.now()
        ) {

          return res
            .status(400)
            .json({
              ok: false,
              error:
                "Verification request expired. Please try again"
            });

        }


        const message =
          makeWalletMessage(
            req.telegramUser.id,

            ethers.getAddress(
              row.wallet_address
            ),

            row.nonce,

            row.nonce_expires_at
          );


        let recovered;


        try {

          recovered =
            ethers.verifyMessage(
              message,
              signature
            );

        } catch {

          return res
            .status(400)
            .json({
              ok: false,
              error:
                "Invalid wallet signature"
            });

        }


        if (
          recovered.toLowerCase() !==
          suppliedAddress.toLowerCase()
        ) {

          return res
            .status(400)
            .json({
              ok: false,
              error:
                "Wallet ownership verification failed"
            });

        }


        const updated =
          await pool.query(
            `
            UPDATE wallet_connections

            SET
              verified=TRUE,
              nonce=NULL,
              nonce_expires_at=NULL,
              updated_at=NOW()

            WHERE telegram_id=$1

            RETURNING
              wallet_address,
              chain_id,
              verified
            `,
            [
              Number(
                req.telegramUser.id
              )
            ]
          );


        return res.json({

          ok: true,

          verified: true,

          wallet_address:
            updated.rows[0]
              .wallet_address,

          chain_id:
            Number(
              updated.rows[0]
                .chain_id
            )

        });

      } catch (error) {

        console.error(
          "VERIFY WALLET ERROR:",
          error
        );


        return res
          .status(400)
          .json({
            ok: false,
            error:
              "Wallet verification failed"
          });

      }

    }
  );


  /* ========================================
     DISCONNECT
  ======================================== */

  app.delete(
    "/api/wallet",
    auth,
    async (
      req,
      res
    ) => {

      try {

        await pool.query(
          `
          DELETE FROM wallet_connections

          WHERE telegram_id=$1
          `,
          [
            Number(
              req.telegramUser.id
            )
          ]
        );


        return res.json({

          ok: true,

          connected: false

        });

      } catch (error) {

        console.error(
          "DISCONNECT WALLET ERROR:",
          error
        );


        return res
          .status(500)
          .json({
            ok: false,
            error:
              "Could not disconnect wallet"
          });

      }

    }
  );

}


module.exports = {
  registerWalletRoutes
};
