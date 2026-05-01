# TG RAG — Telegram-бот с векторным поиском по каналам

Система автоматического сбора постов из Telegram-каналов, их векторной индексации и ответов на вопросы через GPT-4o-mini с пронумерованными источниками. Все переменные окружения (URL сервера, токен, разрешённый chat_id) хранятся в **Google Sheets** и загружаются динамически — менять настройки можно без правки воркфлоу.

```
Telegram-каналы → Node.js сервер → n8n (дедупликация + embeddings + хранение) → Supabase (pgvector)
                                                                                          ↑
Telegram-бот  ←── n8n (история + RAG + GPT-4o-mini) ──────────────────────────────────────┘
                                 ↑
                          Google Sheets (переменные)
```

### Пример ответа бота

```
1. Bitcoin закрылся выше $75 000 впервые за 73 дня. (1)
2. Майкл Сэйлор приобрёл BTC почти на $1 млрд. (1)(2)
3. Bitcoin ETF зафиксировали крупнейший приток средств с января. (2)

📡 Источники:
(1) DEGERNES TRADING — 18 апр.
(2) headlines — 18 апр.
```

---

## Структура проекта

```
tg-rag-project/
├── README.md                     ← английская версия
├── README.ru.md                  ← этот файл
├── .gitignore
├── server/
│   ├── server.js                 # Express + Telegram MTProto сервер
│   ├── session-generator.js      # Утилита для получения SESSION-строки (один раз)
│   ├── package.json
│   └── .env.example              # Шаблон переменных окружения
├── n8n/
│   ├── TG_RAG_1_Ingest.json      # Воркфлоу: сбор, дедупликация и индексация (каждый час)
│   └── TG_RAG_2_Query.json       # Воркфлоу: обработка запросов из Telegram
├── database/
│   └── init.sql                  # Полная схема PostgreSQL / Supabase
└── docs/
    └── google_sheets_template.csv # Шаблон таблицы переменных
```

---

## Требования

| Компонент | Детали |
|-----------|--------|
| VPS / сервер | Node.js 18+ |
| База данных | [Supabase](https://supabase.com) (бесплатный tier подходит) или PostgreSQL с pgvector |
| Автоматизация | [n8n](https://n8n.io) (self-hosted или cloud) |
| ИИ | OpenAI API ключ (`text-embedding-3-small` + `gpt-4o-mini`) |
| Хранилище конфига | Google Sheets (подключается через credential в n8n) |
| Чтение каналов | Личный аккаунт Telegram (не бот) |
| Бот | Создаётся через [@BotFather](https://t.me/BotFather) |

---

## Шаг 1 — Google Sheets: хранилище переменных

Оба воркфлоу читают переменные из Google Таблицы при каждом запуске. Это позволяет менять URL сервера, токен или разрешённый chat_id без редактирования n8n.

### Создание таблицы

1. Создайте новую Google Таблицу
2. Назовите первый лист **`external`**
3. Добавьте два столбца:

| name | value |
|------|-------|
| url | https://IP_ВАШЕГО_СЕРВЕРА:3005 |
| token | ВАШ_API_TOKEN |
| chat_id | ВАШ_TELEGRAM_CHAT_ID |

Готовый шаблон — `docs/google_sheets_template.csv`.

4. Скопируйте **ID таблицы** из URL:
   `https://docs.google.com/spreadsheets/d/`**`ЭТА_ЧАСТЬ`**`/edit`

Этот ID нужно вставить в узел `external access store` в n8n.

---

## Шаг 2 — Получить Telegram API Credentials

1. Перейдите на [my.telegram.org](https://my.telegram.org) и войдите по номеру телефона
2. Откройте **API development tools**
3. Создайте приложение — получите `API_ID` и `API_HASH`

---

## Шаг 3 — Получить SESSION-строку

SESSION-строка авторизует ваш личный аккаунт Telegram на сервере — нужна один раз.

```bash
cd server
npm install
node session-generator.js
```

Скрипт запросит номер телефона, код из Telegram и 2FA пароль (если включён). После успешной авторизации в консоли появится:

```
SESSION=1BVtsOKABu...длинная строка...
```

> ⚠️ Держите эту строку в тайне — она даёт полный доступ к аккаунту. Никогда не коммитьте в git.

---

## Шаг 4 — Настроить и запустить сервер

```bash
cd server
cp .env.example .env
```

Заполните `.env`:

```env
API_ID=12345678
API_HASH=a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4
SESSION=1BVtsOKABu...ваша строка...
PORT=3005
API_TOKEN=любая-случайная-строка
```

Сгенерировать случайный токен:
```bash
openssl rand -hex 16
```

Запустить сервер:
```bash
npm start
```

Проверить:
```bash
curl http://localhost:3005/health
# {"ok":true}

curl "http://localhost:3005/get-channels?token=ВАШ_ТОКЕН"
# [...список каналов...]
```

### Продакшн — запуск через PM2

```bash
npm install -g pm2
pm2 start server.js --name tg-rag-server
pm2 save && pm2 startup
```

---

## Шаг 5 — Инициализировать базу данных

1. Откройте Supabase → **SQL Editor**
2. Вставьте содержимое файла `database/init.sql`
3. Нажмите **Run**

### Таблица конфигурации (`tg_config`)

Все параметры хранятся в базе и меняются через SQL без перезапуска:

| Ключ | По умолчанию | Описание |
|------|-------------|----------|
| `retention_days` | 60 | Хранить сообщения N дней |
| `fetch_limit` | 80 | Сообщений с канала за запуск |
| `fetch_hours_back` | 1 | Глубина выборки в часах |
| `similarity_min` | 0.25 | Минимальный порог сходства (0–1) |
| `search_top_k` | 15 | Количество результатов поиска |

```sql
-- Изменить параметр в любой момент:
UPDATE tg_config SET value = '2' WHERE key = 'fetch_hours_back';
```

### Первый запуск — загрузить 7 дней истории

```sql
UPDATE tg_config SET value = '168' WHERE key = 'fetch_hours_back';
-- После завершения вернуть обратно:
UPDATE tg_config SET value = '1'   WHERE key = 'fetch_hours_back';
```

---

## Шаг 6 — Настроить n8n

### Credentials — создать один раз в n8n (Settings → Credentials)

| Тип | Для чего |
|-----|----------|
| **OpenAI API** | Embeddings + ответы GPT |
| **Postgres** | Подключение к Supabase |
| **Telegram Bot API** | Триггер + отправка сообщений |
| **Google Sheets OAuth2** | Чтение таблицы переменных |

### Импорт воркфлоу

1. **Workflows → Import from file**
2. Импортировать `n8n/TG_RAG_1_Ingest.json`
3. Импортировать `n8n/TG_RAG_2_Query.json`

---

### Воркфлоу 1 — Ingest (`TG_RAG_1_Ingest.json`)

**Запускается каждый час.** Что делает:

1. Читает `url`, `token` из Google Sheets
2. Получает список каналов с Node.js сервера
3. Фильтрует каналы из `SKIP_IDS`
4. Скачивает новые сообщения
5. **Дедупликация** — проверяет Supabase на уже проиндексированные сообщения (экономия OpenAI)
6. Создаёт векторные embeddings батчами по 100
7. Сохраняет в Supabase через upsert
8. Ежедневно в 03:00 удаляет старые сообщения

**Настроить после импорта:**

| Узел | Что изменить |
|------|-------------|
| `external access store` | Вставить ID вашей Google Таблицы, выбрать Google Sheets credential |
| `Attach Config to Channels` | Отредактировать `SKIP_IDS` — добавить ID каналов для исключения |
| Все Postgres-узлы | Выбрать Postgres credential |
| `Batch Embeddings Request` | Выбрать OpenAI credential |

---

### Воркфлоу 2 — Query (`TG_RAG_2_Query.json`)

**Запускается по входящему сообщению в боте.** Что делает:

1. Читает `url`, `token`, `chat_id` из Google Sheets
2. Проверяет авторизацию — отвечает только разрешённому chat_id
3. Обрабатывает текст или голос (голос → транскрипция через Whisper)
4. Загружает историю диалога из Postgres (последние 20 сообщений)
5. Создаёт embedding запроса
6. Векторный поиск в Supabase
7. GPT-4o-mini формирует ответ с пронумерованными источниками `(1)`, `(2)`
8. Сохраняет историю диалога

**Настроить после импорта:**

| Узел | Что изменить |
|------|-------------|
| `external access store` | Вставить ID вашей Google Таблицы, выбрать Google Sheets credential |
| Все Postgres-узлы | Выбрать Postgres credential |
| `Embed User Query` | Выбрать OpenAI credential |
| `Call OpenAI` | Выбрать OpenAI credential |
| `Transcribe Voice` | Выбрать OpenAI credential |
| `Telegram Trigger` | Выбрать Telegram Bot credential |
| `Send to Telegram` | Выбрать Telegram Bot credential |
| `Send No Data Reply` | Выбрать Telegram Bot credential |
| `Get Voice File` | Выбрать Telegram Bot credential |

### Узнать свой Telegram chat_id

Напишите боту [@userinfobot](https://t.me/userinfobot) — он ответит вашим числовым ID. Вставьте его в строку `chat_id` вашей Google Таблицы.

---

## Управление каналами

**Получить список каналов с ID:**
```bash
curl "http://ВАШ_СЕРВЕР:3005/get-channels?token=ВАШ_ТОКЕН"
```

**Добавить канал** — вступите в него с аккаунтом Telegram, который использует сервер. Канал появится в следующем запуске ingest.

**Исключить канал** — добавьте его `id` в `SKIP_IDS` в узле `Attach Config to Channels`.

---

## Мониторинг

```sql
-- Количество сообщений по каналам
SELECT channel_title, COUNT(*) AS msgs, MAX(msg_date) AS latest
FROM tg_messages
GROUP BY channel_title ORDER BY msgs DESC;

-- Лог очистки
SELECT * FROM tg_cleanup_log ORDER BY ran_at DESC LIMIT 10;

-- Найти записи с числовым channel_title (старые данные)
SELECT DISTINCT channel_id, channel_title, COUNT(*)
FROM tg_messages WHERE channel_title ~ '^\d+$'
GROUP BY channel_id, channel_title;

-- Исправить
UPDATE tg_messages SET channel_title = 'Название канала'
WHERE channel_id = '1234567890' AND channel_title ~ '^\d+$';
```

---

## Архитектурные особенности

- **pgvector HNSW индекс** — быстрый приближённый поиск ближайших соседей
- **text-embedding-3-small** — самая дешёвая модель OpenAI, хорошее качество для новостей
- **Батчи по 100** — не превышает лимит токенов OpenAI
- **Предварительная дедупликация** — уже проиндексированные сообщения пропускаются до вызова API
- **Upsert** — повторный запуск ingest не создаёт дублей
- **Google Sheets** — смена URL/токена без редактирования n8n
- **История диалога** — последние 20 сообщений загружаются при каждом запросе
- **Нумерованные источники** — GPT ставит `(1)`, `(2)` после каждого факта

### Примерная стоимость (один активный пользователь)

| Компонент | ~В месяц |
|-----------|---------|
| Embedding запросов (100/день) | $0.01 |
| Ответы GPT-4o-mini | $1–3 |
| Embeddings при ingeste | $0.30 |
| Supabase | Бесплатный tier |
| **Итого** | **~$2–4** |

---

## Лицензия

MIT
