# Bahá'í Quote Bot (Telegram)

Simple Node.js Telegram-bot that sends random Bahá'í quotes to users on a daily schedule and supports text search & admin broadcasts.

## Features

* Daily personal quote at user-defined time & timezone (Luxon).
* On-demand quote via /quote and inline "🔄 Ещё" button (30 s cooldown).
* AI-powered quote explanations via /explain command and "🧠 Объяснить" button.
* /find <text> – fuzzy search (Fuse.js).
* Admin broadcasts: /push (one-time), /weekly (recurring), and /daily (daily at specific time).
* GPT-powered broadcasts with customizable prompts.
* Image support in broadcasts.
* Simple admin web-panel (Express + Bootstrap) for statistics, quote & broadcast management.
* Role-based access control (super/admin/guest) for web panel.
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
   OPENAI_API_KEY=sk-...     # OpenAI API key for GPT broadcasts and AI explanations
   OPENAI_API_BASE_URL=https://api.llm7.io/v1  # API base URL (default: llm7.io, can use OpenAI etc)
   OPENAI_MODEL=gpt-4.1-nano # OpenAI model
   OPENAI_MAX_TOKENS=200     # max tokens per GPT response
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
   # Add Telegram admin
   npm run add-admin 123456789   # Telegram id
   
   # Add web panel admin
   npm run add-admin --web username password
   ```
   or via SQL:
   ```sql
   -- Telegram admin
   INSERT INTO admins(chat_id) VALUES (123456789);
   
   -- Web panel admin (password should be bcrypt hashed)
   INSERT INTO web_admins(username, password, role) VALUES ('username', 'hashed_password', 'admin');
   ```
5. **Run**
   ```bash
   npm start           # start the bot
   npm run admin-web   # (optional) launch web admin panel
   ```

## User Commands

* `/start` – subscribe to daily quotes and broadcasts
* `/stop` – unsubscribe from everything
* `/quote [N]` – get random or specific quote
* `/explain [N]` – get AI explanation for quote (random or specific)
* `/time HH:MM` – set daily quote time
* `/randomtime` – set random daily time
* `/daily on|off` – toggle daily quotes
* `/broadcast on|off` – toggle broadcasts
* `/tz Area/City` – change timezone
* `/find text` – search quotes
* `/count` – show total quotes
* `/help` – show this help

## Admin Commands

* `/push YYYY-MM-DD HH:MM text` – schedule one-time broadcast
* `/weekly <1-7> HH:MM text` – schedule weekly broadcast
* `/blist [N]` – list last N broadcasts (default 20)
* `/bdel ID` – delete broadcast
* `/bedit ID text` – edit broadcast text

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
