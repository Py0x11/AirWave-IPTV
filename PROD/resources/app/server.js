const path = require('path');
const fs = require('fs');
const express = require('express');
const { Readable } = require('stream');
const catalog = require('./lib/catalog');

const VERSION = '0.1.0-beta';
const PORT = parseInt(process.env.PORT, 10) || 8585;
const USER_DIR = path.join(__dirname, 'data', 'user');
const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length'
]);

const DEFAULT_SETTINGS = { nsfwHidden: true, showSD: true, lowLatency: false, autoFallback: true };

const app = express();
let settings = { ...DEFAULT_SETTINGS };
let favorites = [];
let recents = [];
let refreshing = false;
let httpServer = null;

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
}

function loadUserData() {
  settings = { ...DEFAULT_SETTINGS, ...readJson(path.join(USER_DIR, 'settings.json'), {}) };
  favorites = readJson(path.join(USER_DIR, 'favorites.json'), []) || [];
  recents = readJson(path.join(USER_DIR, 'recents.json'), []) || [];
}

function noCache(res) {
  res.set('Cache-Control', 'no-store');
}

async function ensureCatalog(res) {
  if (catalog.get()) return true;
  try {
    await catalog.build(false);
    return true;
  } catch (e) {
    res.status(503).json({ error: e.message });
    return false;
  }
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/api/status', (req, res) => {
  noCache(res);
  res.json({ ...catalog.status(), version: VERSION });
});

app.get('/api/categories', async (req, res) => {
  if (!(await ensureCatalog(res))) return;
  noCache(res);
  res.json({ items: catalog.categoriesWithCounts(settings) });
});

app.get('/api/group', async (req, res) => {
  if (!(await ensureCatalog(res))) return;
  noCache(res);
  res.json(catalog.groupCounts(req.query.category || 'all', settings));
});

app.get('/api/channels', async (req, res) => {
  if (!(await ensureCatalog(res))) return;
  noCache(res);
  res.json(
    catalog.listChannels(settings, {
      q: req.query.q,
      category: req.query.category,
      country: req.query.country,
      language: req.query.language,
      limit: req.query.limit,
      offset: req.query.offset
    })
  );
});

app.post('/api/channels/by-ids', async (req, res) => {
  if (!(await ensureCatalog(res))) return;
  noCache(res);
  res.json({ items: catalog.byIds(settings, (req.body && req.body.ids) || []) });
});

app.get('/api/settings', (req, res) => {
  noCache(res);
  res.json(settings);
});

app.post('/api/settings', (req, res) => {
  const body = req.body || {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (typeof body[key] === 'boolean') settings[key] = body[key];
  }
  writeJson(path.join(USER_DIR, 'settings.json'), settings);
  noCache(res);
  res.json(settings);
});

app.get('/api/user-data', (req, res) => {
  noCache(res);
  res.json({ favorites, recents });
});

app.post('/api/favorites/toggle', (req, res) => {
  const id = req.body && req.body.id;
  if (!id) {
    res.status(400).json({ error: 'id required' });
    return;
  }
  const idx = favorites.indexOf(id);
  let added;
  if (idx >= 0) {
    favorites.splice(idx, 1);
    added = false;
  } else {
    favorites.unshift(id);
    added = true;
  }
  writeJson(path.join(USER_DIR, 'favorites.json'), favorites);
  noCache(res);
  res.json({ favorites, added });
});

app.post('/api/recent', (req, res) => {
  const id = req.body && req.body.id;
  if (!id) {
    res.status(400).json({ error: 'id required' });
    return;
  }
  recents = [{ id, ts: Date.now() }, ...recents.filter(r => r.id !== id)].slice(0, 60);
  writeJson(path.join(USER_DIR, 'recents.json'), recents);
  noCache(res);
  res.json({ recents });
});

app.post('/api/refresh', async (req, res) => {
  if (refreshing) {
    res.status(409).json({ error: 'refresh already running' });
    return;
  }
  refreshing = true;
  try {
    await catalog.build(true);
    noCache(res);
    res.json(catalog.status());
  } catch (e) {
    res.status(502).json({ error: e.message });
  } finally {
    refreshing = false;
  }
});

function wrapHlsUrl(rawUrl, base, proxyBase, ua, referrer) {
  let abs;
  try {
    abs = new URL(rawUrl, base).href;
  } catch {
    return rawUrl;
  }
  const params = new URLSearchParams({ url: abs });
  if (ua) params.set('ua', ua);
  if (referrer) params.set('ref', referrer);
  return `${proxyBase}?${params.toString()}`;
}

function rewriteHls(text, base, proxyBase, ua, referrer) {
  const out = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) {
      out.push('');
      continue;
    }
    if (t.startsWith('#')) {
      out.push(
        line.replace(/URI="([^"]+)"/g, (m, u) => `URI="${wrapHlsUrl(u, base, proxyBase, ua, referrer)}"`)
      );
      continue;
    }
    out.push(wrapHlsUrl(t, base, proxyBase, ua, referrer));
  }
  return out.join('\n');
}

app.get('/proxy', async (req, res) => {
  const raw = req.query.url;
  if (!raw) {
    res.status(400).json({ error: 'missing url' });
    return;
  }
  let target;
  try {
    target = new URL(raw);
  } catch {
    res.status(400).json({ error: 'bad url' });
    return;
  }
  if (!/^https?:$/.test(target.protocol)) {
    res.status(400).json({ error: 'bad protocol' });
    return;
  }
  if (req.headers.host && target.host === req.headers.host) {
    res.status(400).json({ error: 'blocked self' });
    return;
  }
  const meta = catalog.streamMeta(target.href) || {};
  const ua = req.query.ua || meta.userAgent || DEFAULT_UA;
  const headers = { 'user-agent': ua };
  const referrer = req.query.ref || meta.referrer;
  if (referrer) {
    headers.referer = referrer;
    try {
      headers.origin = new URL(referrer).origin;
    } catch {
      headers.origin = undefined;
    }
  }
  if (req.headers.range) headers.range = req.headers.range;
  if (req.headers.accept) headers.accept = req.headers.accept;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  let upstream;
  try {
    upstream = await fetch(target.href, { headers, redirect: 'follow', signal: controller.signal });
  } catch {
    if (!res.headersSent) res.status(502).json({ error: 'upstream fetch failed' });
    return;
  } finally {
    clearTimeout(timer);
  }
  const ct = (upstream.headers.get('content-type') || '').toLowerCase();
  const isPlaylist =
    upstream.ok && (/\.m3u8?$/.test(target.pathname) || /mpegurl|m3u/.test(ct));
  if (isPlaylist) {
    let text;
    try {
      text = await upstream.text();
    } catch {
      if (!res.headersSent) res.status(502).json({ error: 'playlist read failed' });
      return;
    }
    const host = req.headers.host || `localhost:${PORT}`;
    const proxyBase = `http://${host}/proxy`;
    res.status(upstream.status);
    for (const [key, value] of upstream.headers) {
      if (HOP_HEADERS.has(key)) continue;
      if (key === 'content-encoding' || key === 'etag') continue;
      res.set(key, value);
    }
    res.set('Content-Type', 'application/vnd.apple.mpegurl');
    res.set('Cache-Control', 'no-store');
    res.set('Access-Control-Allow-Origin', '*');
    res.send(rewriteHls(text, upstream.url, proxyBase, ua, referrer));
    return;
  }
  res.status(upstream.status);
  for (const [key, value] of upstream.headers) {
    if (HOP_HEADERS.has(key)) continue;
    res.set(key, value);
  }
  res.set('Access-Control-Allow-Origin', '*');
  if (!upstream.body) {
    res.end();
    return;
  }
  const stream = Readable.fromWeb(upstream.body);
  res.on('close', () => controller.abort());
  stream.on('error', () => {
    if (!res.headersSent) res.status(502);
    res.end();
  });
  stream.pipe(res);
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'not found' });
});

async function startServer() {
  if (httpServer) return PORT;
  fs.mkdirSync(USER_DIR, { recursive: true });
  loadUserData();
  try {
    await catalog.build(false);
  } catch (e) {
    console.error(`[catalog] initial build failed: ${e.message}`);
  }
  return new Promise((resolve, reject) => {
    const server = app.listen(PORT, () => {
      httpServer = server;
      const status = catalog.status();
      console.log('');
      console.log(`  AirWave TV ${VERSION}`);
      console.log(`  http://localhost:${PORT}`);
      if (status.ready) {
        console.log(`  channels: ${status.channels}  streams: ${status.streams}  data: ${status.updatedAt}`);
      } else {
        console.log('  catalog not ready, data loads on first request');
      }
      console.log('');
      resolve(PORT);
    });
    server.on('error', e => reject(e));
  });
}

process.on('unhandledRejection', err => {
  console.error('[unhandledRejection]', err && err.message ? err.message : err);
});

if (require.main === module) {
  startServer().catch(e => {
    if (e.code === 'EADDRINUSE') {
      console.error(`port ${PORT} is already in use`);
    } else {
      console.error(e);
    }
    process.exit(1);
  });
}

module.exports = { startServer, app, PORT };
