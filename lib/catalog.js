const fs = require('fs');
const path = require('path');
const m3u = require('./m3u');

const API = 'https://iptv-org.github.io/api';
const FILES = ['channels', 'streams', 'countries', 'categories', 'logos', 'languages'];
const TTL_MS = 12 * 3600 * 1000;
const CACHE_DIR = path.join(__dirname, '..', 'data', 'cache');

let cat = null;

function cachePath(name) {
  return path.join(CACHE_DIR, `${name}.json`);
}

async function download(name, force) {
  const file = cachePath(name);
  if (!force && fs.existsSync(file)) {
    const age = Date.now() - fs.statSync(file).mtimeMs;
    if (age < TTL_MS) return;
  }
  const res = await fetch(`${API}/${name}.json`);
  if (!res.ok) throw new Error(`${name}.json: HTTP ${res.status}`);
  const text = await res.text();
  JSON.parse(text);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function qualityInfo(q) {
  const s = String(q || '').toLowerCase();
  if (/4k|2160|uhd/.test(s)) return { rank: 6, label: '4K' };
  if (/1440|1080/.test(s)) return { rank: 5, label: 'FHD' };
  if (/720/.test(s)) return { rank: 4, label: 'HD' };
  if (/480|576|360|240|sd/.test(s)) return { rank: 3, label: 'SD' };
  return { rank: 3, label: '' };
}

function streamType(url) {
  if (url.endsWith('.m3u8')) return 'hls';
  if (url.endsWith('.mp4')) return 'mp4';
  return null;
}

function normalizeStream(s) {
  const url = s.url || '';
  if (!url || !/^https?:\/\//.test(url)) return null;
  const type = streamType(url);
  if (!type) return null;
  const labels = s.labels || [];
  if (labels.includes('Geo-blocked')) return null;
  const q = qualityInfo(s.quality);
  return {
    url,
    title: s.title || '',
    type,
    not247: labels.includes('Not 24/7'),
    rank: q.rank,
    quality: q.label,
    userAgent: s.user_agent || null,
    referrer: s.referrer || null
  };
}

function streamSort(a, b) {
  if (a.rank !== b.rank) return b.rank - a.rank;
  if (a.not247 !== b.not247) return a.not247 ? 1 : -1;
  return String(a.title).localeCompare(String(b.title));
}

function bestLogoUrl(entries) {
  let best = null;
  let bestScore = -1;
  for (const l of entries) {
    const score = (l.in_use ? 2 : 0) + (l.feed ? 0 : 1) + (l.width || 0) / 10000;
    if (score > bestScore) {
      bestScore = score;
      best = l;
    }
  }
  return best && best.url ? best.url : null;
}

function normalize(raw) {
  const countryNames = {};
  const countryFlags = {};
  const countryLanguages = {};
  for (const c of raw.countries || []) {
    countryNames[c.code] = c.name;
    countryFlags[c.code] = c.flag || '';
    countryLanguages[c.code] = c.languages || [];
  }
  const languageNames = {};
  for (const l of raw.languages || []) languageNames[l.code] = l.name;

  const logoMap = {};
  for (const entry of raw.logos || []) {
    if (!entry.channel) continue;
    (logoMap[entry.channel] = logoMap[entry.channel] || []).push(entry);
  }

  const streamsByChannel = {};
  let keptStreams = 0;
  for (const s of raw.streams || []) {
    const norm = normalizeStream(s);
    if (!norm || !s.channel) continue;
    (streamsByChannel[s.channel] = streamsByChannel[s.channel] || []).push(norm);
    keptStreams++;
  }

  const streamMetaMap = new Map();
  const byId = new Map();
  const byCategory = {};
  const byCountry = {};
  const byLanguage = {};
  const channels = [];
  let skippedChannels = 0;

  for (const ch of raw.channels || []) {
    if (ch.closed) {
      skippedChannels++;
      continue;
    }
    const streams = (streamsByChannel[ch.id] || []).sort(streamSort);
    const seen = new Set();
    const uniqueStreams = [];
    for (const s of streams) {
      if (seen.has(s.url)) continue;
      seen.add(s.url);
      uniqueStreams.push(s);
      streamMetaMap.set(s.url, { userAgent: s.userAgent, referrer: s.referrer });
    }
    if (!uniqueStreams.length) {
      skippedChannels++;
      continue;
    }
    const country = ch.country || '';
    const langCodes = [...new Set(countryLanguages[country] || [])];
    const cats = [...new Set((ch.categories || []).filter(Boolean))];
    const best = uniqueStreams[0];
    const alt = (ch.alt_names || []).filter(Boolean);
    const channel = {
      id: ch.id,
      name: ch.name || ch.id,
      network: ch.network || null,
      country,
      countryName: countryNames[country] || null,
      countryFlag: countryFlags[country] || '',
      categories: cats,
      languages: langCodes,
      languageNames: langCodes.map(c => languageNames[c]).filter(Boolean),
      isNsfw: !!ch.is_nsfw,
      website: ch.website || null,
      logo: logoMap[ch.id] ? bestLogoUrl(logoMap[ch.id]) : null,
      streams: uniqueStreams,
      quality: best.quality,
      not247: best.not247
    };
    channel.search = [...alt, channel.name, channel.network, channel.countryName, ...channel.languageNames]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    channels.push(channel);
    byId.set(channel.id, channel);
    for (const c of cats) (byCategory[c] = byCategory[c] || []).push(channel);
    if (country) (byCountry[country] = byCountry[country] || []).push(channel);
    for (const l of langCodes) (byLanguage[l] = byLanguage[l] || []).push(channel);
  }

  const times = FILES.map(f => {
    try {
      return fs.statSync(cachePath(f)).mtimeMs;
    } catch {
      return 0;
    }
  });

  return {
    updatedAt: new Date(Math.max(...times)).toISOString(),
    countryNames,
    languageNames,
    categoryMeta: raw.categories || [],
    channels,
    byId,
    byCategory,
    byCountry,
    byLanguage,
    streamMeta: streamMetaMap,
    skipped: {
      streams: Math.max((raw.streams || []).length - keptStreams, 0),
      channels: skippedChannels
    }
  };
}

async function build(force = false) {
  if (cat && !force) return cat;
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const results = await Promise.allSettled(FILES.map(name => download(name, force)));
  const missing = FILES.filter(name => !fs.existsSync(cachePath(name)));
  if (missing.length === FILES.length) {
    const firstError = results.find(r => r.status === 'rejected');
    throw new Error(firstError && firstError.reason ? firstError.reason.message : 'all sources failed');
  }
  if (missing.length) {
    if (cat) return cat;
    throw new Error(`incomplete cache, missing: ${missing.join(', ')}`);
  }
  const raw = {};
  for (const name of FILES) raw[name] = readJson(cachePath(name), null);
  for (const name of FILES) {
    if (!raw[name]) throw new Error(`cache unreadable: ${name}.json`);
  }
  cat = normalize(raw);

  // Merge M3U source channels (TizTV, TizX, etc.)
  try {
    const m3uBuild = m3u.build;
    const m3uSources = m3u.DEFAULT_SOURCES;
    const m3uResult = await m3uBuild(m3uSources, true);
    // Add all M3U channels; some stream URLs may already exist in iptv-org but the
    // channel name/context (group, logo, metadata) will be new. Callers can filter
    // by the optional `source` field if desired.
    for (const ch of m3uResult.channels) {
      cat.channels.push(ch);
    }
  } catch (e) {
    // Non-fatal: continue with iptv-org channels only
  }

  return cat;
}

function passFilter(ch, settings) {
  if (settings.nsfwHidden && ch.isNsfw) return false;
  if (!settings.showSD && ch.quality === 'SD') return false;
  return true;
}

function listChannels(settings, opts = {}) {
  const c = cat;
  if (!c) return { items: [], total: 0 };
  const category = opts.category || 'all';
  let pool = category !== 'all' ? c.byCategory[category] || [] : c.channels;
  const query = (opts.q || '').trim().toLowerCase();
  const country = opts.country || '';
  const language = opts.language || '';
  const items = [];
  for (const ch of pool) {
    if (!passFilter(ch, settings)) continue;
    if (country && ch.country !== country) continue;
    if (language && !ch.languages.includes(language)) continue;
    if (query && !ch.search.includes(query)) continue;
    items.push(ch);
  }
  const limit = Math.min(Math.max(parseInt(opts.limit, 10) || 300, 1), 1000);
  const offset = Math.max(parseInt(opts.offset, 10) || 0, 0);
  return { items: items.slice(offset, offset + limit), total: items.length, offset, limit };
}

function byIds(settings, ids) {
  const c = cat;
  if (!c || !Array.isArray(ids)) return [];
  const out = [];
  for (const id of ids) {
    const ch = c.byId.get(id);
    if (ch && passFilter(ch, settings)) out.push(ch);
  }
  return out;
}

function categoriesWithCounts(settings) {
  const c = cat;
  if (!c) return [];
  const counts = new Map();
  counts.set('all', 0);
  for (const ch of c.channels) {
    if (!passFilter(ch, settings)) continue;
    counts.set('all', counts.get('all') + 1);
    for (const catId of ch.categories) counts.set(catId, (counts.get(catId) || 0) + 1);
  }
  const meta = c.categoryMeta || [];
  const cats = [...counts.entries()].map(([id, count]) => {
    const m = meta.find(x => x.id === id);
    return {
      id,
      name: id === 'all' ? 'All Channels' : m ? m.name : id.charAt(0).toUpperCase() + id.slice(1),
      description: m ? m.description || '' : '',
      count
    };
  });
  cats.sort((a, b) => (a.id === 'all' ? -1 : b.id === 'all' ? 1 : b.count - a.count || a.name.localeCompare(b.name)));
  return cats;
}

function groupCounts(category, settings) {
  const c = cat;
  if (!c) return { countries: [], languages: [] };
  let pool = category && category !== 'all' ? c.byCategory[category] || [] : c.channels;
  const countryCounts = new Map();
  const languageCounts = new Map();
  for (const ch of pool) {
    if (!passFilter(ch, settings)) continue;
    if (ch.country) countryCounts.set(ch.country, (countryCounts.get(ch.country) || 0) + 1);
    for (const l of ch.languages) languageCounts.set(l, (languageCounts.get(l) || 0) + 1);
  }
  return {
    countries: [...countryCounts.entries()]
      .map(([code, count]) => ({ id: code, name: c.countryNames[code] || code, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    languages: [...languageCounts.entries()]
      .map(([code, count]) => ({ id: code, name: c.languageNames[code] || code, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  };
}

function streamMeta(url) {
  return cat && cat.streamMeta ? cat.streamMeta.get(url) || null : null;
}

function status() {
  if (!cat) return { ready: false };
  let streams = 0;
  for (const ch of cat.channels) streams += ch.streams.length;
  return {
    ready: true,
    updatedAt: cat.updatedAt,
    channels: cat.channels.length,
    streams,
    skipped: cat.skipped
  };
}

module.exports = {
  build,
  status,
  listChannels,
  byIds,
  categoriesWithCounts,
  groupCounts,
  streamMeta,
  get: () => cat
};
