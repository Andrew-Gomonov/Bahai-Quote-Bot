# Bahá'í Quote Bot (Telegram)

Simple Node.js Telegram-bot that sends random Bahá'í quotes to users on a daily schedule and supports text search & admin broadcasts.

## Features

* Daily personal quote at user-defined time & timezone (Luxon).
* Instant quote via /quote and inline "🔄 Ещё" button (30 s cooldown).
* /find <text> – fuzzy search (Fuse.js).
* Admin broadcasts: /push and /weekly.
* SQLite3 storage – single `bot.db` file.

## Setup

1. **Clone & install**
   ```bash
   npm install
   ```
2. **Add environment variables**
   Create `.env` file next to `package.json`:
   ```
   BOT_TOKEN=<your telegram bot token>
   COOLDOWN_SEC=30 # optional
   DB_PATH=bot.db   # optional
   ```
3. **Import quotes**
   Fill table `quotes` manually or via SQL:
   ```bash
   npm run import
   ```
5. **(Optional) Add admins**
   ```bash
    npm run add-admin 123456789;
   ```
6. **Run**
   ```bash
   npm start
   ```

## Docker quick-start

1. Build image
   ```bash
   docker build -t bahai-quote-bot .
   ```
2. Run (mount local `data` dir to keep `bot.db` persistent):
   ```bash
   docker run -d --name bahai-quote-bot \
     -e BOT_TOKEN=YOUR_TOKEN \
     -p 3000:3000 \
     -v $(pwd)/data:/app \
     bahai-quote-bot
   ```

   или ещё проще через docker-compose:
   ```bash
   BOT_TOKEN=YOUR_TOKEN docker compose up -d
   ```

Админ-панель будет на http://localhost:3000.

---
