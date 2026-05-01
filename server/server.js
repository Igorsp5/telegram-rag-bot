const express = require('express');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
require('dotenv').config();

const app = express();
const port = parseInt(process.env.PORT || '3005', 10);

const apiId = parseInt(process.env.API_ID, 10);
const apiHash = process.env.API_HASH;
const session = new StringSession(process.env.SESSION || '');
const apiToken = (process.env.API_TOKEN || '').trim();

if (!apiId || !apiHash || !process.env.SESSION) {
  console.error('Не хватает API_ID / API_HASH / SESSION в .env');
  process.exit(1);
}

if (!apiToken) {
  console.error('Не хватает API_TOKEN в .env');
  process.exit(1);
}

let clientPromise;

async function getClient() {
  if (!clientPromise) {
    clientPromise = (async () => {
      const c = new TelegramClient(session, apiId, apiHash, {
        connectionRetries: 5,
      });
      await c.connect();
      return c;
    })().catch((err) => {
      clientPromise = undefined;
      throw err;
    });
  }
  return clientPromise;
}

function normalizeLimit(value, fallback = 10, max = 500) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

function checkApiToken(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const bearerToken = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : '';
  const queryToken = typeof req.query.token === 'string' ? req.query.token.trim() : '';
  const providedToken = bearerToken || queryToken;
  if (!providedToken || providedToken !== apiToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function parseTimestamp(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  if (/^\d+$/.test(String(raw))) {
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor(d.getTime() / 1000);
}

app.get('/health', async (req, res) => {
  try {
    await getClient();
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/get-channels', checkApiToken, async (req, res) => {
  try {
    const tg = await getClient();
    const dialogs = await tg.getDialogs({ limit: 200 });
    const channels = dialogs
      .filter((dialog) => {
        const cls = dialog?.entity?.className;
        return cls === 'Channel' || cls === 'Chat';
      })
      .map((dialog) => ({
        id: dialog.entity?.id?.toString?.() ?? null,
        title: dialog.entity?.title ?? null,
        username: dialog.entity?.username ?? null,
        className: dialog.entity?.className ?? null,
      }));
    return res.json(channels);
  } catch (err) {
    console.error('Ошибка при получении каналов:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

app.get('/get-messages', checkApiToken, async (req, res) => {
  const channel = req.query.channel;
  const limit = normalizeLimit(req.query.limit, 10, 500);
  const offsetId = parseInt(req.query.offsetId || '0', 10);

  if (!channel) {
    return res.status(400).json({ error: 'channel parameter is required' });
  }

  const sinceParam = req.query.since;
  const offsetDateParam = req.query.offsetDate;

  let sinceTs = null;
  if (sinceParam !== undefined && sinceParam !== '') {
    sinceTs = parseTimestamp(sinceParam);
    if (sinceTs === null) {
      return res.status(400).json({
        error: 'Invalid since format. Use YYYY-MM-DD, ISO datetime or unix timestamp (sec)',
      });
    }
  }

  let offsetDateTs = null;
  if (sinceTs === null && offsetDateParam) {
    offsetDateTs = parseTimestamp(offsetDateParam);
    if (offsetDateTs === null) {
      return res.status(400).json({
        error: 'Invalid offsetDate format. Use YYYY-MM-DD or ISO datetime',
      });
    }
  }

  try {
    const tg = await getClient();
    let entity;
    try {
      entity = await tg.getEntity(channel);
    } catch (e) {
      return res.status(404).json({
        error: 'Чат/канал не найден или у аккаунта нет доступа',
      });
    }

    let messages = [];
    if (sinceTs !== null) {
      for await (const m of tg.iterMessages(entity, {
        offsetDate: sinceTs,
        reverse: true,
        limit,
      })) {
        messages.push(m);
      }
      messages.reverse();
    } else {
      const options = { limit };
      if (!Number.isNaN(offsetId) && offsetId > 0) {
        options.offsetId = offsetId;
      }
      if (offsetDateTs !== null) {
        options.offsetDate = offsetDateTs;
      }
      messages = await tg.getMessages(entity, options);
    }

    const result = messages.map((msg) => ({
      id: msg.id,
      text: msg.message || '',
      date: msg.date,
      senderId: msg.senderId ? msg.senderId.toString() : null,
      views: msg.views ?? null,
      forwards: msg.forwards ?? null,
      media: !!msg.media,
      replyTo: msg.replyTo?.replyToMsgId ?? null,
    }));

    return res.json({
      channel,
      mode: sinceTs !== null ? 'forward' : 'backward',
      since: sinceTs,
      count: result.length,
      nextOffsetId:
        result.length > 0
          ? sinceTs !== null
            ? result[0].id
            : result[result.length - 1].id
          : null,
      messages: result,
    });
  } catch (err) {
    console.error('Ошибка при получении сообщений:', err);
    return res.status(500).json({ error: err.message });
  }
});

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Telegram API сервер запущен на http://0.0.0.0:${port}`);
});

async function shutdown(signal) {
  console.log(signal + ' received, shutting down gracefully...');
  server.close(() => {
    console.log('HTTP server closed');
  });
  if (clientPromise) {
    try {
      const c = await clientPromise;
      await c.disconnect();
      console.log('Telegram client disconnected');
    } catch (err) {
      console.error('Error during Telegram disconnect:', err.message);
    }
  }
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
