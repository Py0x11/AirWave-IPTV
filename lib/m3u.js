const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '..', 'data', 'cache');
const TTL_MS = 6 * 3600 * 1000;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const DEFAULT_SOURCES = [
  {
    id: 'tiztv',
    name: 'TizTV',
    url: 'https://www.dropbox.com/scl/fi/ldvqithn5hvq39t/Tiz_m3u.m3u?rlkey=&dl=1',
    homepage: 'https://sites.google.com/view/tizpiracy/m3u'
  },
  {
    id: 'tizx',
    name: 'TizX',
    url: 'https://www.dropbox.com/scl/fi/19vrutzew9hgdxn9dpehu/0Tiz_xXx_Live.m3u?rlkey=bz6j7v8dg2h1vm9q3pkdlnru2&dl=1',
    homepage: 'https://sites.google.com/view/tizpiracy/m3u'
  }
];

const OBFUSCATED_MAP = { "\u29B7": "i", "\u2C4D": "z", "\u019C": "T", "\u228E": "V", "\u04BF": ")", "\u04FF": "(" };

function sourceFile(id) {
  return path.join(CACHE_DIR, `m3u-${id}.txt`);
}

function parseAttrs(text) {
  const attrs = {};
  const re = /([a-zA-Z0-9_-]+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(text))) attrs[m[1]] = m[2];
  return attrs;
}

function decodeName(name) {
  return String(name || '')
    .replace(/[꧁☠꧂]/g, '')
.replace(/[\u019C\u29B7\u2C4D\u019C\u228E]/g, m => OBFUSCATED_MAP[m] || "")
.replace(/[\u04BF\u04FF]/g, m => OBFUSCATED_MAP[m] || "")
    .replace(/\s{2,}/g, ' ')
    .replace(/\|\s*$/, '')
    .trim();
}

function cleanGroup(group) {
  const g = String(group || '').trim();
  if (!g) return 'General';
  if (/nsfw/i.test(g)) return 'NSFW';
  if (/radio/i.test(g)) return 'Radio';
  if (/vod|movie/i.test(g)) return 'Movies';
  return g;
}

function qualityRank(label) {
  const s = String(label || '').toLowerCase();
  if (/2160|4k/.test(s)) return 6;
  if (/1440|1080/.test(s)) return 5;
  if (/720/.test(s)) return 4;
  if (/480|360|240|sd/.test(s)) return 3;
  return 2;
}

function qualityLabel(label) {
  const s = String(label || '').toLowerCase();
  if (/2160|4k/.test(s)) return '4K';
  if (/1440/.test(s)) return 'FHD+';
  if (/1080/.test(s)) return 'FHD';
  if (/720/.test(s)) return 'HD';
  if (/480|360|240|sd/.test(s)) return 'SD';
  return '';
}

function parseM3U(text) {
  const lines = text.split(/\r?\n/);
  const entries = [];
  let pending = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF')) {
      const comma = line.indexOf(',');
      const head = comma >= 0 ? line.slice(0, comma) : line;
      const title = comma >= 0 ? line.slice(comma + 1) : '';
      const attrs = parseAttrs(head);
      pending = { attrs, title };
      continue;
    }
    if (line.startsWith('#')) continue;
    if (!pending) continue;
    if (!/^https?:\/\//i.test(line)) {
      pending = null;
      continue;
    }
    const name = decodeName(pending.attrs['tvg-name'] || pending.title);
    const group = cleanGroup(pending.attrs['group-title']);
    const logo = pending.attrs['tvg-logo'] || '';
    const quality = qualityLabel(pending.title);
    entries.push({
      name: name || 'Unknown',
      group,
      logo,
      quality,
      rank: qualityRank(pending.title),
      url: line,
      tvgId: pending.attrs['tvg-id'] || ''
    });
    pending = null;
  }
  return entries;
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: '*/*' },
    redirect: 'follow'
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (!text.includes('#EXTM3U')) throw new Error('not an M3U playlist');
  return text;
}

async function loadSource(source, force) {
  const file = sourceFile(source.id);
  if (!force && fs.existsSync(file)) {
    const age = Date.now() - fs.statSync(file).mtimeMs;
    if (age < TTL_MS) {
      return { source, text: fs.readFileSync(file, 'utf8'), cached: true };
    }
  }
  let text;
  try {
    text = await fetchText(source.url);
  } catch (e) {
    if (fs.existsSync(file)) {
      return { source, text: fs.readFileSync(file, 'utf8'), cached: true, stale: e.message };
    }
    throw e;
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
  return { source, text, cached: false };
}

function toChannels(source, entries, sourceId) {
  const byName = new Map();
  for (const e of entries) {
    const key = `${e.group}||${e.name.toLowerCase()}`;
    let ch = byName.get(key);
    if (!ch) {
      ch = {
        id: `${sourceId}-${byName.size}-${e.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`,
        name: e.name,
        network: e.group,
        country: '',
        countryName: null,
        countryFlag: '',
        categories: [e.group],
        languages: [],
        languageNames: [],
        isNsfw: /nsfw/i.test(e.group) || /nsfw/i.test(e.name),
        website: source.homepage || null,
        logo: e.logo || null,
        streams: [],
        quality: e.quality,
        not247: false
      };
      byName.set(key, ch);
    }
    ch.streams.push({
      url: e.url,
      title: `${e.group} ${e.quality}`.trim(),
      type: 'hls',
      not247: false,
      rank: e.rank,
      quality: e.quality,
      userAgent: null,
      referrer: null
    });
    if (e.rank > 0 && (!ch.quality || e.rank > (ch.streams[0].rank || 0))) ch.quality = e.quality;
  }
  const channels = [...byName.values()];
  for (const ch of channels) {
    ch.streams.sort((a, b) => b.rank - a.rank || String(a.title).localeCompare(String(b.title)));
    ch.search = [ch.name, ch.network, ...ch.categories].filter(Boolean).join(' ').toLowerCase();
  }
  return channels;
}

async function build(sources, force) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const results = await Promise.allSettled(sources.map(s => loadSource(s, force)));
  const channels = [];
  const errors = [];
  const meta = [];
  let entries = 0;
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'rejected') {
      errors.push(`${sources[i].name}: ${r.reason && r.reason.message ? r.reason.message : r.reason}`);
      continue;
    }
    const parsed = parseM3U(r.value.text);
    entries += parsed.length;
    channels.push(...toChannels(r.value.source, parsed, sources[i].id));
    meta.push({
      id: sources[i].id,
      name: sources[i].name,
      url: sources[i].url,
      channels: parsed.length,
      cached: !!r.value.cached,
      stale: r.value.stale || null
    });
  }
  return { channels, meta, errors, entries };
}

module.exports = { build, parseM3U, DEFAULT_SOURCES, decodeName, CACHE_DIR };
