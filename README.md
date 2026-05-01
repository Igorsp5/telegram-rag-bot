# Telegram RAG Bot — News Q&A with Vector Search

RAG-powered Telegram bot that answers user questions using real channel data with source citations.  
Aggregates and summarizes real-time crypto and news content from multiple Telegram sources.  
Builds concise, source-grounded answers from noisy unstructured data.

**Tech stack:** Node.js, n8n, Supabase (pgvector), OpenAI API, Telegram API

---

## 🎯 Why this project

Telegram channels contain a large amount of unstructured news data.  
This project solves:

- Information overload (too many posts)
- Lack of structured search across channels
- No source-grounded answers

The bot aggregates, filters, and summarizes news using RAG with verifiable sources.

---

## 🚀 Example Bot Response

**User Question**
> What happened with Bitcoin today?

**Answer**

1. Bitcoin closed above $75,000 for the first time in 73 days. (1)  
2. Michael Saylor purchased nearly $1B worth of Bitcoin. (1)(2)  
3. Bitcoin ETFs recorded their largest single-day inflows since mid-January. (2)  

📡 **Sources**  
(1) DEGERNES TRADING — Apr 18  
(2) headlines — Apr 18

---

## ⚡ Key Features

- RAG-based question answering over Telegram data  
- Source-grounded responses with citations (1)(2)  
- Deduplication before embedding (cost optimization)  
- Vector search with pgvector (HNSW)  
- Config via Google Sheets (no redeploy)  
- Conversation history (context-aware answers)  

---

## 🧠 Architecture

```text
Telegram channels → Node.js server → n8n (dedup + embeddings + storage) → Supabase (pgvector)
                                                                                   ↑
Telegram bot  ←── n8n (history + RAG + GPT-4o-mini) ──────────────────────────────┘
                              ↑
                       Google Sheets (variables)
```

---

## ⚠️ Limitations

- Depends on Telegram API availability  
- Quality depends on source channels  
- No advanced reranking yet  

---

## Project Structure

```
telegram-rag-bot/
├── README.md                     ← this file (English)
├── README.ru.md                  ← Russian version
├── .gitignore
├── server/
│   ├── server.js                 # Express + Telegram MTProto API server
│   ├── session-generator.js      # One-time utility to obtain SESSION string
│   ├── package.json
│   └── .env.example              # Environment variable template
├── n8n/
│   ├── TG_RAG_1_Ingest.json      # Workflow: collect, dedup & index messages (hourly)
│   └── TG_RAG_2_Query.json       # Workflow: answer Telegram bot queries
├── database/
│   └── init.sql                  # Full PostgreSQL / Supabase schema
└── docs/
    └── google_sheets_template.csv # Template for the variables spreadsheet
```
---

## Requirements

| Component | Details |
|-----------|---------|
| VPS / server | Node.js 18+ |
| Database | Supabase or PostgreSQL with pgvector |
| Automation | n8n |
| AI | OpenAI API |
| Config store | Google Sheets |
| Telegram reader | Personal Telegram account |
| Telegram bot | @BotFather |

---

## Step 1 — Google Sheets: Variable Store

Both n8n workflows read their runtime variables from a Google Sheet at startup. This lets you change the server URL, API token, or allowed chat ID without touching n8n.

### Create the spreadsheet

1. Create a new Google Sheet
2. Name the first sheet tab **`external`**
3. Add two columns with this exact content:

| name | value |
|------|-------|
| url | https://YOUR_SERVER_IP:3005 |
| token | YOUR_API_TOKEN |
| chat_id | YOUR_TELEGRAM_CHAT_ID |

A ready-to-import template is in `docs/google_sheets_template.csv`.

4. Copy the **Spreadsheet ID** from the URL:
   `https://docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit`

You will paste this ID into n8n when configuring the `external access store` node.

---

## Step 2 — Get Telegram API Credentials

1. Go to [my.telegram.org](https://my.telegram.org) and log in
2. Open **API development tools**
3. Create an application — you'll get `API_ID` and `API_HASH`

---

## Step 3 — Generate a SESSION String

The SESSION string authenticates your personal Telegram account so the server can read channel messages.

```bash
cd server
npm install
node session-generator.js
```

The script prompts for your phone number, verification code, and 2FA password (if set). On success:

```
SESSION=1BVtsOKABu...long string...
```

> ⚠️ Keep this string private — it grants full account access. Never commit it to git.

---

## Step 4 — Configure and Start the Server

```bash
cd server
cp .env.example .env
```

Fill in `.env`:

```env
API_ID=12345678
API_HASH=a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4
SESSION=1BVtsOKABu...
PORT=3005
API_TOKEN=any-random-secret-string
```

Generate a random token:
```bash
openssl rand -hex 16
```

Start the server:
```bash
npm start
```

Verify:
```bash
curl http://localhost:3005/health
# {"ok":true}

curl "http://localhost:3005/get-channels?token=YOUR_API_TOKEN"
# [...list of channels...]
```

### Production — run with PM2

```bash
npm install -g pm2
pm2 start server.js --name tg-rag-server
pm2 save && pm2 startup
```

---

## Step 5 — Initialize the Database

1. Open Supabase → **SQL Editor**
2. Paste the contents of `database/init.sql`
3. Click **Run**

### Configuration table (`tg_config`)

All operational parameters live in the database and can be changed at any time:

| Key | Default | Description |
|-----|---------|-------------|
| `retention_days` | 60 | Delete messages older than N days |
| `fetch_limit` | 80 | Messages fetched per channel per run |
| `fetch_hours_back` | 1 | How many hours back to look each run |
| `similarity_min` | 0.25 | Minimum cosine similarity (0–1) |
| `search_top_k` | 15 | Number of results from vector search |

```sql
-- Change a parameter at runtime:
UPDATE tg_config SET value = '2' WHERE key = 'fetch_hours_back';
```

### First run — load 7 days of history

```sql
UPDATE tg_config SET value = '168' WHERE key = 'fetch_hours_back';
-- After the run completes, reset:
UPDATE tg_config SET value = '1'   WHERE key = 'fetch_hours_back';
```

---

## Step 6 — Set Up n8n

### Credentials to create in n8n (Settings → Credentials)

| Credential type | Used for |
|----------------|----------|
| **OpenAI API** | Embeddings + GPT answers |
| **Postgres** | Supabase connection |
| **Telegram Bot API** | Bot trigger + sending messages |
| **Google Sheets OAuth2** | Reading variables spreadsheet |

### Import workflows

1. **Workflows → Import from file**
2. Import `n8n/TG_RAG_1_Ingest.json`
3. Import `n8n/TG_RAG_2_Query.json`

---

### Workflow 1 — Ingest (`TG_RAG_1_Ingest.json`)

**Runs every hour.** What it does:

1. Reads `url`, `token` from Google Sheets
2. Fetches channel list from the Node.js server
3. Filters channels in `SKIP_IDS`
4. Downloads new messages
5. **Deduplication** — checks Supabase for already-indexed messages (saves OpenAI costs)
6. Creates vector embeddings in batches of 100
7. Upserts into Supabase
8. Daily cleanup at 03:00

**Configure after import:**

| Node | What to change |
|------|---------------|
| `external access store` | Set your Google Sheet ID and select Google Sheets credential |
| `Attach Config to Channels` | Edit `SKIP_IDS` — add channel IDs to exclude |
| All Postgres nodes | Select your Postgres credential |
| `Batch Embeddings Request` | Select your OpenAI credential |

---

### Workflow 2 — Query (`TG_RAG_2_Query.json`)

**Triggered by Telegram messages.** What it does:

1. Reads `url`, `token`, `chat_id` from Google Sheets
2. Auth check — only responds to the allowed chat ID (`vars.chat_id`)
3. Handles text or voice messages (voice → Whisper transcription)
4. Loads conversation history from Postgres (last 20 messages)
5. Embeds the query
6. Vector similarity search in Supabase
7. GPT-4o-mini generates answer with numbered sources `(1)`, `(2)`
8. Saves conversation history

**Configure after import:**

| Node | What to change |
|------|---------------|
| `external access store` | Set your Google Sheet ID and select Google Sheets credential |
| All Postgres nodes | Select your Postgres credential |
| `Embed User Query` | Select your OpenAI credential |
| `Call OpenAI` | Select your OpenAI credential |
| `Transcribe Voice` | Select your OpenAI credential |
| `Telegram Trigger` | Select your Telegram Bot credential |
| `Send to Telegram` | Select your Telegram Bot credential |
| `Send No Data Reply` | Select your Telegram Bot credential |
| `Get Voice File` | Select your Telegram Bot credential |

### Find your Telegram chat ID

Message [@userinfobot](https://t.me/userinfobot) — it replies with your numeric ID. Put this in the `chat_id` row of your Google Sheet.

---

## Managing Channels

**Get channel IDs:**
```bash
curl "http://YOUR_SERVER:3005/get-channels?token=YOUR_API_TOKEN"
```

**Add a channel** — join it with the Telegram account the server uses. It appears in the next ingest run.

**Exclude a channel** — add its `id` to the `SKIP_IDS` set in the `Attach Config to Channels` node.

---

## Monitoring

```sql
-- Messages per channel
SELECT channel_title, COUNT(*) AS msgs, MAX(msg_date) AS latest
FROM tg_messages
GROUP BY channel_title ORDER BY msgs DESC;

-- Cleanup log
SELECT * FROM tg_cleanup_log ORDER BY ran_at DESC LIMIT 10;

-- Fix old records with numeric channel_title
SELECT DISTINCT channel_id, channel_title, COUNT(*)
FROM tg_messages WHERE channel_title ~ '^\d+$'
GROUP BY channel_id, channel_title;

UPDATE tg_messages SET channel_title = 'Channel Name'
WHERE channel_id = '1234567890' AND channel_title ~ '^\d+$';
```

---

## Architecture Notes

- **pgvector HNSW index** — fast approximate nearest-neighbor search
- **text-embedding-3-small** — cheapest OpenAI embedding model, good for news
- **Batched embeddings (100/batch)** — stays within OpenAI token limits
- **Pre-flight deduplication** — skips already-indexed messages before calling OpenAI
- **Upsert on conflict** — safe to re-run ingest, no duplicates
- **Google Sheets variable store** — change server URL or token without editing n8n
- **Per-user conversation history** — last 20 messages loaded per query
- **Numbered sources** — GPT cites `(1)`, `(2)` after each fact

### Estimated monthly cost (single active user)

| Component | ~Cost |
|-----------|-------|
| Embedding queries (100/day) | $0.01 |
| GPT-4o-mini answers | $1–3 |
| Ingest embeddings | $0.30 |
| Supabase | Free tier |
| **Total** | **~$2–4** |

---

## License

MIT

