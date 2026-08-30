# BharatMine Full Stack
Secure foundation for a Telegram Mini App backend.

Setup:
1. Create PostgreSQL database.
2. Run schema.sql.
3. Copy .env.example to .env.
4. Put the BotFather token ONLY in TELEGRAM_BOT_TOKEN.
5. Set DATABASE_URL.
6. Run npm install && npm start.

The task claim route is intentionally a demo reward flow. Before real rewards, verify Telegram membership/social actions server-side and connect a legitimate CPA/game provider through its webhook/postback. Never put the bot token in frontend code.
