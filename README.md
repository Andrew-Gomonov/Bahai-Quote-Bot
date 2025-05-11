# Bahá'í Quote Bot (Telegram)

Simple Node.js Telegram-bot that sends random Bahá'í quotes to users on a daily schedule and supports text search & admin broadcasts.

## Features

* Daily personal quote at user-defined time & timezone (Luxon).
* On-demand quote via /quote and inline "🔄 Ещё" button (30 s cooldown).
* /find <text> – fuzzy search (Fuse.js).
* Admin broadcasts: /push and /weekly (text + optional image).
* Simple admin web-panel (Express + Bootstrap) for statistics, quote & broadcast management (HTTP Basic Auth).
* SQLite (single `bot.db` file), zero external services.
* Docker & docker-compose ready.

## Setup

1. **Clone & install**
   ```bash
   npm install
   ```
2. **Add environment variables**
   Create `.env` file next to `package.json`:
   ```
   BOT_TOKEN=<telegram bot token here>

   # Optional
   DB_PATH=bot.db            # path to SQLite file
   COOLDOWN_SEC=30           # /quote cooldown in seconds
   ADMIN_PORT=3000           # admin panel port
   ADMIN_USER=admin          # HTTP auth login
   ADMIN_PASSWORD=admin      # HTTP auth password
   ```
3. **Import quotes**
   Add your quotes to the database in one of two ways:
   1. **Script** – put them in a JSON file (`[{"text":"..."}]`) and run:
      ```bash
      npm run import path/to/quotes.json
      ```
   2. **SQL** – insert manually:
      ```sql
      INSERT INTO quotes(text) VALUES ("First quote…"), ("Second quote…");
      ```
4. **(Optional) Add admins**
   ```bash
   npm run add-admin 123456789   # Telegram id
   ```
   or via SQL:
   ```sql
   INSERT INTO admins(chat_id) VALUES (123456789);
   ```
5. **Run**
   ```bash
   npm start           # start the bot
   npm run admin-web   # (optional) launch web admin panel
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
     -e ADMIN_USER=admin \
     -e ADMIN_PASSWORD=secret \
     -p 3000:3000 \
     -v $(pwd)/data:/app \
     bahai-quote-bot
   ```

   or it must be much easy with docker-compose:
   ```bash
   BOT_TOKEN=YOUR_TOKEN docker compose up -d
   ```

Admin-panel will be on http://localhost:3000.

---
