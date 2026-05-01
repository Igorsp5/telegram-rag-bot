-- ============================================================
-- ПОЛНАЯ ИНИЦИАЛИЗАЦИЯ БД для Telegram RAG
-- ============================================================

DROP TABLE IF EXISTS n8n_telegram_aggregation_chat_histories CASCADE;
DROP TABLE IF EXISTS tg_cleanup_log CASCADE;
DROP TABLE IF EXISTS tg_messages CASCADE;
DROP TABLE IF EXISTS tg_config CASCADE;

CREATE EXTENSION IF NOT EXISTS vector;

-- ------------------------------------------------------------
-- 1. Таблица конфигурации
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tg_config (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    description TEXT,
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO tg_config (key, value, description) VALUES
    ('retention_days',   '60',  'Хранить сообщения N дней, старше — удалять'),
    ('fetch_limit',      '80',  'Сколько сообщений брать с каждого канала за один запуск'),
    ('fetch_hours_back', '1',   'Забирать сообщения за последние N часов'),
    ('similarity_min',   '0.25','Минимальный порог косинусного сходства при поиске (0–1)'),
    ('search_top_k',     '15',  'Сколько результатов возвращать при векторном поиске')
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------
-- 2. Основная таблица сообщений
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tg_messages (
    id            BIGSERIAL    PRIMARY KEY,
    msg_id        TEXT         NOT NULL,
    channel_id    TEXT         NOT NULL,
    channel_title TEXT,                   -- читаемое название канала (title из API)
    text          TEXT         NOT NULL,
    msg_date      TIMESTAMPTZ  NOT NULL,
    embedding     vector(1536),
    created_at    TIMESTAMPTZ  DEFAULT NOW(),
    UNIQUE (msg_id, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_tg_messages_embedding
    ON tg_messages
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS idx_tg_messages_channel
    ON tg_messages (channel_id);

CREATE INDEX IF NOT EXISTS idx_tg_messages_date
    ON tg_messages (msg_date DESC);

-- ------------------------------------------------------------
-- 3. История чатов
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS n8n_telegram_aggregation_chat_histories (
    id          BIGSERIAL    PRIMARY KEY,
    session_id  TEXT         NOT NULL,
    message     JSONB        NOT NULL,
    created_at  TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_histories_session
    ON n8n_telegram_aggregation_chat_histories (session_id, created_at DESC);

-- ------------------------------------------------------------
-- 4. Лог очистки
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tg_cleanup_log (
    id             BIGSERIAL    PRIMARY KEY,
    deleted_count  INT          NOT NULL,
    cutoff_date    TIMESTAMPTZ  NOT NULL,
    retention_days INT          NOT NULL,
    ran_at         TIMESTAMPTZ  DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 5. Функция поиска
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION search_messages(
    query_embedding vector(1536),
    match_count     INT  DEFAULT NULL,
    channel_filter  TEXT DEFAULT NULL
)
RETURNS TABLE (
    msg_id        TEXT,
    channel_id    TEXT,
    channel_title TEXT,
    text          TEXT,
    msg_date      DATE,
    similarity    FLOAT
)
LANGUAGE plpgsql STABLE
AS $$
DECLARE
    v_top_k     INT;
    v_retention INT;
    v_sim_min   FLOAT;
BEGIN
    SELECT value::INT   INTO v_top_k     FROM tg_config WHERE key = 'search_top_k';
    SELECT value::INT   INTO v_retention FROM tg_config WHERE key = 'retention_days';
    SELECT value::FLOAT INTO v_sim_min   FROM tg_config WHERE key = 'similarity_min';

    IF match_count IS NOT NULL THEN
        v_top_k := match_count;
    END IF;

    RETURN QUERY
    SELECT
        m.msg_id,
        m.channel_id,
        m.channel_title,
        m.text,
        m.msg_date::date,
        (1 - (m.embedding <=> query_embedding))::FLOAT AS similarity
    FROM tg_messages m
    WHERE
        m.msg_date >= NOW() - (v_retention || ' days')::INTERVAL
        AND (channel_filter IS NULL OR m.channel_id = channel_filter)
        AND m.embedding IS NOT NULL
        AND (1 - (m.embedding <=> query_embedding)) >= v_sim_min
    ORDER BY m.embedding <=> query_embedding
    LIMIT v_top_k;
END;
$$;

-- ------------------------------------------------------------
-- 6. Функция очистки
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION cleanup_old_messages()
RETURNS TABLE (deleted_count INT, retention_days INT, cutoff_date TIMESTAMPTZ)
LANGUAGE plpgsql
AS $$
DECLARE
    v_retention INT;
    v_cutoff    TIMESTAMPTZ;
    v_deleted   INT;
BEGIN
    SELECT value::INT INTO v_retention
    FROM tg_config WHERE key = 'retention_days';

    v_cutoff := NOW() - (v_retention || ' days')::INTERVAL;

    DELETE FROM tg_messages WHERE msg_date < v_cutoff;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;

    INSERT INTO tg_cleanup_log (deleted_count, cutoff_date, retention_days)
    VALUES (v_deleted, v_cutoff, v_retention);

    RETURN QUERY SELECT v_deleted, v_retention, v_cutoff;
END;
$$;

-- ------------------------------------------------------------
-- Проверка
-- ------------------------------------------------------------
SELECT key, value, description FROM tg_config ORDER BY key;
