'use strict';
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtT = (t) => {
  t = Math.max(0, Math.floor(t || 0));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0');
};
const video = () => $('#video');
const S = { screen: 'live', cats: { countries: [], languages: [] }, byId: new Map(), favorites: new Set(), recents: [], settings: {}, status: null, search: '', focusEl: null, hero: null, heroSet: false, heroTimer: null, heroLoader: null, interacted: false, trendList: null, streamsCacheId: null, detailOpen: false, detailId: null, detailReturn: null, searchTimer: null };
const P = { open: false, ch: null, streams: [], si: 0, k: 0, loader: null, statsOn: false, statTimer: null, tick: null, ctlTimer: null };
const SVG_PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
const SVG_PAUSE = '<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
const SVG_VOL = '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05A4.47 4.47 0 0 0 16.5 12z"/></svg>';
const SVG_MUTED = '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm18.6 3 2-2-1.4-1.4-2 2-2-2L16.8 10l2 2-2 2 1.4 1.4 2-2 2 2 1.4-1.4-2-2z"/></svg>';

async function api(path, opts) {
  try {
    const r = await fetch(path, opts);
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; }
}

function toast(msg) {
  const t = $('#toasts');
  if (!t) return;
  t.innerHTML = '<div class="toast">' + esc(msg) + '</div>';
  if (toast.timer) clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { const el = t.querySelector('.toast'); if (el) el.remove(); }, 2600);
}

function makeLoader(v, url, opts) {
  opts = opts || {};
  let done = false, retry = 0, timer = null, hls = null;
  const state = { hls: null, destroy() { done = true; if (timer) clearTimeout(timer); if (hls) { try { hls.destroy(); } catch (e) {} hls = null; } v.pause(); v.removeAttribute('src'); try { v.load(); } catch (e) {} } };
  const fail = () => { if (done) return; done = true; if (timer) clearTimeout(timer); state.destroy(); if (opts.onErr) opts.onErr(); };
  const ok = () => { if (done) return; done = true; if (timer) clearTimeout(timer); if (opts.onOk) opts.onOk(); };
  if (window.Hls && Hls.isSupported() && /\.m3u8(\?|$)/i.test(url)) {
    hls = new Hls({ maxBufferLength: 20, maxMaxBufferLength: 60, liveSyncDurationCount: 3, lowLatencyMode: !!opts.lowLatency, enableWorker: true });
    state.hls = hls;
    hls.on(Hls.Events.ERROR, (ev, data) => {
      if (done || !data || !data.fatal) return;
      if (retry < 3 && data.type !== Hls.ErrorTypes.MEDIA_ERROR) { retry++; setTimeout(() => { if (!done) try { hls.startLoad(); } catch (e) {} }, 400); return; }
      fail();
    });
    hls.loadSource(url);
    hls.attachMedia(v);
  } else {
    v.src = url;
    v.addEventListener('error', () => fail(), { once: true });
  }
  timer = setTimeout(fail, 12000);
  v.play().then(ok).catch(() => {});
  v.addEventListener('playing', ok, { once: true });
  return state;
}

function setFocus(el, fallback) {
  let t = el ? (el.classList.contains('focusable') ? el : el.closest('.focusable')) : null;
  if (!t) t = fallback || null;
  if (t === S.focusEl) return;
  if (S.focusEl) S.focusEl.classList.remove('focused');
  S.focusEl = t;
  if (t) {
    t.classList.add('focused');
    try { t.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' }); } catch (e) { try { t.scrollIntoView(); } catch (e2) {} }
  }
}

function cyc(list, cur, dir) {
  if (!list.length) return null;
  let i = cur ? list.indexOf(cur) : -1;
  if (i === -1) return dir < 0 ? list[list.length - 1] : list[0];
  return list[(i + dir + list.length) % list.length];
}

function zoneList(zone) {
  let els = [];
  if (zone === 'nav') els = [$('#logo'), ...$$('.nav-pill'), $('#btn-search'), $('#btn-settings'), $('#avatar')];
  else if (zone === 'bill') els = [$('#hero-play'), $('#hero-fav'), $('#hero-info')];
  else if (zone === 'panel') els = [$('#p-back'), $('#p-bar'), $('#fs-play'), $('#fs-mute'), $('#fs-vol'), $('#fs-stats'), $('#fs-full'), $('#p-ph-back')];
  else if (zone === 'detail') els = [$('#d-close'), $('#d-play'), $('#d-fav'), $('#d-share'), ...$$('#d-row .mini')];
  else if (zone === 'settings') els = [...$$('#settings-dialog .sw-row'), $('#btn-refresh'), $('#btn-settings-close')];
  return els.filter((e) => e && e.offsetParent !== null && e.classList.contains('focusable'));
}

const activePill = () => $('.nav-pill.active') || $$('.nav-pill').filter((p) => p.offsetParent !== null)[0] || $('#logo');
const heroVisible = () => !$('#hero').classList.contains('hidden-hero') && $('#hero').offsetParent !== null && S.heroSet;
const cardRowOf = (row) => $$('.card', row).filter((c) => c.classList.contains('focusable'));
function firstCardOverall() {
  for (const r of $$('#rows .row')) {
    const c = cardRowOf(r)[0];
    if (c) return c;
  }
  return null;
}

function rowH(card, dir) {
  const cards = $$('.card[data-rid="' + card.dataset.rid + '"]').filter((c) => c.classList.contains('focusable'));
  const i = cards.indexOf(card);
  if (i === -1) return;
  const n = cards[i + dir];
  setFocus(n || cards[dir > 0 ? 0 : cards.length - 1]);
}

function panelH(el, dir) {
  if (el === $('#p-bar')) { seekBy(dir * 10); return; }
  if (el === $('#fs-vol')) { setVol(video().volume + dir * 0.05); return; }
  setFocus(cyc(zoneList('panel'), el, dir));
}

function moveRowV(row, dir) {
  const rows = $$('#rows .row');
  const i = rows.indexOf(row);
  for (let j = i + dir; j >= 0 && j < rows.length; j += dir) {
    const cards = cardRowOf(rows[j]);
    if (cards.length) {
      const cur = $$('.card[data-rid="' + S.focusEl.dataset.rid + '"]').indexOf(S.focusEl);
      setFocus(cards[Math.max(0, Math.min(cur, cards.length - 1))]);
      return;
    }
  }
}

function detailV(el, dir) {
  const minis = $$('#d-row .mini');
  const i = minis.indexOf(el);
  if (i === -1) {
    if (dir > 0) { if (minis[0]) setFocus(minis[0]); return; }
    setFocus(cyc(zoneList('detail').filter((x) => !x.classList.contains('mini')), el, -1));
    return;
  }
  if (dir < 0) {
    if (i < 3) {
      const btns = [$('#d-play'), $('#d-fav'), $('#d-share')].filter((b) => b && b.offsetParent !== null);
      setFocus(btns[i % btns.length] || $('#d-play'));
      return;
    }
    setFocus(minis[i - 3]);
    return;
  }
  const t = minis[i + 3];
  if (t) setFocus(t);
}

function moveH(dir) {
  const el = S.focusEl;
  if (!el) return;
  const zone = el.dataset.zone;
  if (zone === 'row') { rowH(el, dir); return; }
  if (zone === 'panel') { panelH(el, dir); return; }
  if (zone === 'nav' || zone === 'bill' || zone === 'settings' || zone === 'detail') { setFocus(cyc(zoneList(zone), el, dir)); return; }
}

function moveV(dir) {
  const el = S.focusEl;
  if (!el) return;
  const zone = el.dataset.zone;
  if (zone === 'detail') { detailV(el, dir); return; }
  if (zone === 'settings') { setFocus(cyc(zoneList('settings'), el, dir)); return; }
  if (zone === 'row') {
    const row = el.closest('.row');
    const rows = $$('#rows .row');
    if (dir < 0 && rows.indexOf(row) === 0) { setFocus(heroVisible() ? $('#hero-play') : activePill()); return; }
    moveRowV(row, dir);
    return;
  }
  if (zone === 'nav') {
    if (dir > 0) { setFocus(heroVisible() ? $('#hero-play') : firstCardOverall()); return; }
    setFocus(cyc(zoneList('nav'), el, -1));
    return;
  }
  if (zone === 'bill') {
    if (dir > 0) { setFocus(firstCardOverall()); return; }
    setFocus(activePill());
  }
}

function searchKeys(e) {
  if (e.key === 'ArrowDown') { e.preventDefault(); $('#search-input').blur(); setFocus(firstCardOverall()); return; }
  if (e.key === 'ArrowUp') { e.preventDefault(); setFocus($('#btn-search')); return; }
  if (e.key === 'Escape' || e.key === 'Backspace') { e.preventDefault(); closeSearch(); return; }
  if (e.key === 'Enter') e.preventDefault();
}

function playerKeys(e) {
  showControls();
  const k = e.key;
  if (k === ' ' || k === 'k' || k === 'K') { e.preventDefault(); togglePlay(); return; }
  if (k === 'm' || k === 'M') { e.preventDefault(); toggleMute(); return; }
  if (k === 'f' || k === 'F') { e.preventDefault(); toggleFull(); return; }
  if (k === 's' || k === 'S') { e.preventDefault(); toggleStats(); return; }
  if (k === 'n' || k === 'N') { e.preventDefault(); attemptStream(P.k + 1); return; }
  if (k === 'Escape' || k === 'Backspace') { e.preventDefault(); closePlayer(); return; }
  if (k === 'ArrowUp') { e.preventDefault(); setVol(video().volume + 0.05); return; }
  if (k === 'ArrowDown') { e.preventDefault(); setVol(video().volume - 0.05); return; }
  if (k === 'ArrowLeft') { e.preventDefault(); moveH(-1); return; }
  if (k === 'ArrowRight') { e.preventDefault(); moveH(1); return; }
  if (k === 'Enter') {
    e.preventDefault();
    if (S.focusEl === $('#p-bar')) { seekBy(10); return; }
    if (S.focusEl) S.focusEl.click();
  }
}

function globalKeys(e) {
  const el = S.focusEl;
  if (e.key === '/') { e.preventDefault(); openSearch(); return; }
  if (e.key === 'z' || e.key === 'Z') { zap(); return; }
  if (e.key === 'Escape' || e.key === 'Backspace') {
    e.preventDefault();
    if (S.detailOpen) { closeDetail(); return; }
    if (settingsOpen()) { closeSettings(); return; }
    if ($('#search-bar').classList.contains('open')) closeSearch();
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    if (el === $('#logo')) { switchScreen('live'); return; }
    if (el && el.classList.contains('card') && el.dataset.id) { openDetail(el.dataset.id); return; }
    if (el) el.click();
    return;
  }
  if (e.key === 'ArrowLeft') { e.preventDefault(); moveH(-1); return; }
  if (e.key === 'ArrowRight') { e.preventDefault(); moveH(1); return; }
  if (e.key === 'ArrowUp') { e.preventDefault(); moveV(-1); return; }
  if (e.key === 'ArrowDown') { e.preventDefault(); moveV(1); }
}

function togglePlay() { const v = video(); if (v.paused) v.play().catch(() => {}); else v.pause(); showControls(); }
function toggleMute() { const v = video(); v.muted = !v.muted; syncVol(); showControls(); }
function toggleFull() {
  const b = $('#player-box');
  if (document.fullscreenElement) document.exitFullscreen();
  else if (b.requestFullscreen) b.requestFullscreen();
  showControls();
}
function toggleStats() {
  P.statsOn = !P.statsOn;
  $('#p-stats').hidden = !P.statsOn;
  if (P.statsOn) writeStats();
  showControls();
}
function setVol(x) {
  const v = video();
  const n = Math.min(1, Math.max(0, x));
  v.volume = n;
  v.muted = n === 0;
  syncVol();
}
function syncVol() {
  const v = video();
  $('#fs-vol').value = Math.round(v.volume * 100);
  $('#fs-mute').innerHTML = v.muted || v.volume === 0 ? SVG_MUTED : SVG_VOL;
}
function seekBy(sec) {
  const v = video();
  if (v.duration && isFinite(v.duration)) { v.currentTime = Math.min(v.duration, Math.max(0, v.currentTime + sec)); showControls(); }
  else toast('Live stream — seek unavailable');
}
function seekClick(e) {
  const v = video();
  if (!v.duration || !isFinite(v.duration)) { toast('Live stream — seek unavailable'); return; }
  const r = e.currentTarget.getBoundingClientRect();
  v.currentTime = Math.min(v.duration, Math.max(0, ((e.clientX - r.left) / r.width) * v.duration));
}

function startTick() { stopTick(); P.tick = setInterval(updateTime, 500); updateTime(); }
function stopTick() { if (P.tick) clearInterval(P.tick); P.tick = null; }
function updateTime() {
  const v = video();
  if (v.duration && isFinite(v.duration)) {
    const pct = (v.currentTime / v.duration) * 100;
    $('#p-fill').style.width = pct + '%';
    $('#p-dot').style.left = pct + '%';
    $('#fs-time').textContent = fmtT(v.currentTime) + ' / ' + fmtT(v.duration);
    $('#fs-live').classList.add('hidden');
  } else {
    $('#p-fill').style.width = '100%';
    $('#p-dot').style.left = '100%';
    $('#fs-time').textContent = 'LIVE';
    $('#fs-live').classList.remove('hidden');
  }
}

const statsHTML = () =>
  '<div class="pstat"><b id="st-src">—</b><span>Source</span></div>' +
  '<div class="pstat"><b id="st-res">—</b><span>Resolution</span></div>' +
  '<div class="pstat"><b id="st-br">—</b><span>Bitrate</span></div>' +
  '<div class="pstat"><b id="st-buf">—</b><span>Buffer</span></div>' +
  '<div class="pstat"><b id="st-drop">—</b><span>Dropped</span></div>' +
  '<div class="pstat"><b id="st-lat">—</b><span>Latency</span></div>';

function startStats() { stopStats(); $('#p-stats').innerHTML = statsHTML(); P.statTimer = setInterval(writeStats, 1000); writeStats(); }
function stopStats() { if (P.statTimer) clearInterval(P.statTimer); P.statTimer = null; }
function writeStats() {
  if (!P.statsOn) return;
  const v = video();
  const q = (id, val) => { const e = $(id); if (e) e.textContent = val; };
  q('#st-src', 'Source ' + (P.si + 1) + '/' + P.streams.length + (P.k % 2 ? ' (proxy)' : ''));
  q('#st-res', v.videoWidth ? v.videoWidth + 'x' + v.videoHeight : '—');
  q('#st-br', P.loader && P.loader.hls && P.loader.hls.bandwidthEstimate ? Math.round(P.loader.hls.bandwidthEstimate / 1000) + ' kbps' : '—');
  q('#st-buf', v.buffered.length ? (v.buffered.end(v.buffered.length - 1) - v.currentTime).toFixed(1) + ' s' : '—');
  if (v.getVideoPlaybackQuality) { const g = v.getVideoPlaybackQuality(); q('#st-drop', g.droppedVideoFrames + ' frames'); }
  q('#st-lat', P.loader && P.loader.hls && P.loader.hls.latency != null ? P.loader.hls.latency.toFixed(1) + ' s' : '—');
}

function showControls() {
  $('#fs-controls').classList.remove('off');
  $('#p-top').classList.remove('off');
  if (P.ctlTimer) clearTimeout(P.ctlTimer);
  P.ctlTimer = setTimeout(() => {
    if (P.open && !video().paused && !$('#p-placeholder').offsetParent) { $('#fs-controls').classList.add('off'); $('#p-top').classList.add('off'); }
  }, 3000);
}

async function markRecent(id) {
  const res = await api('/api/recent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
  if (res && res.recents) { S.recents = res.recents; if (S.screen === 'recent') renderRows(); }
}

async function openPlayer(ch) {
  if (!ch) return;
  if (P.open) closePlayer();
  let item = S.byId.get(ch.id) || ch;
  if (!item.streams || !item.streams.length) {
    const res = await api('/api/channels/by-ids', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [ch.id] }) });
    if (res && res.items && res.items[0]) { item = res.items[0]; S.byId.set(item.id, item); }
  }
  P.streams = (item.streams || []).filter((s) => s && s.url);
  if (!P.streams.length) { toast('No streams available for ' + item.name); return; }
  P.ch = item;
  P.streamsCacheId = item.id;
  P.open = true;
  $('#player-box').classList.remove('hidden');
  document.body.classList.add('watching');
  $('#p-ph-title').textContent = item.name;
  $('#p-title').textContent = item.name;
  showSpinner(true);
  attemptStream(0);
  setFocus($('#fs-play'), $('#p-bar'));
}

function attemptStream(k) {
  if (!P.open) return;
  P.k = k;
  P.si = Math.floor(k / 2);
  if (P.si >= P.streams.length) { showFail('All sources failed'); return; }
  const s = P.streams[P.si];
  let url = s.url;
  if (k % 2 === 1) url = '/proxy?url=' + encodeURIComponent(url);
  $('#p-placeholder').classList.add('hidden');
  if (P.loader) { P.loader.destroy(); P.loader = null; }
  stopStats();
  P.statsOn = false;
  $('#p-stats').hidden = true;
  const v = video();
  v.classList.remove('on');
  P.loader = makeLoader(v, url, {
    lowLatency: !!S.settings.lowLatency,
    onOk() {
      showSpinner(false);
      $('#p-placeholder').classList.add('hidden');
      v.classList.add('on');
      syncVol();
      startTick();
      showControls();
      markRecent(P.ch.id);
    },
    onErr() {
      if (S.settings.autoFallback) attemptStream(k + 1);
      else showFail('Stream failed — press N for next source');
    }
  });
}

function showFail(msg) {
  showSpinner(false);
  $('#p-ph-title').textContent = msg;
  $('#p-placeholder').classList.remove('hidden');
}
function showSpinner(on) { $('#p-spinner').classList.toggle('hidden', !on); }

function closePlayer() {
  P.open = false;
  if (P.loader) { P.loader.destroy(); P.loader = null; }
  stopTick();
  stopStats();
  P.statsOn = false;
  if (P.ctlTimer) clearTimeout(P.ctlTimer);
  const v = video();
  v.pause();
  v.removeAttribute('src');
  try { v.load(); } catch (e) {}
  if (document.fullscreenElement) document.exitFullscreen();
  $('#p-stats').hidden = true;
  $('#p-spinner').classList.add('hidden');
  $('#p-placeholder').classList.remove('hidden');
  $('#fs-controls').classList.remove('off');
  $('#p-top').classList.remove('off');
  $('#player-box').classList.add('hidden');
  document.body.classList.remove('watching');
  if (S.detailOpen) setFocus($('#d-play'), $('#d-close'));
  else setFocus(activePill(), $('#logo'));
}

async function zap() {
  const res = await api('/api/channels?limit=60');
  const items = (res && res.items) || [];
  if (!items.length) { toast('No channels loaded yet'); return; }
  const ch = items[Math.floor(Math.random() * items.length)];
  S.byId.set(ch.id, ch);
  if (P.open) {
    P.ch = ch;
    P.streams = (ch.streams || []).filter((s) => s && s.url);
    P.streamsCacheId = ch.id;
    $('#p-title').textContent = ch.name;
    showSpinner(true);
    attemptStream(0);
  } else {
    openPlayer(ch);
  }
}

const top10 = (arr) => (arr || []).slice().sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, 10);
const tileHTML = (ch) => ch.logo
  ? '<img class="tile" alt="" src="' + esc(ch.logo) + '" onerror="this.style.display=\'none\'">'
  : '<div class="tile noimg"></div>';

function cardHTML(ch, rid, idx, bigRank) {
  return '<button class="card' + (bigRank ? ' livetv' : '') + ' focusable" data-zone="row" data-rid="' + esc(rid) +
    '" data-idx="' + idx + '" data-id="' + esc(ch.id) + '">' + tileHTML(ch) +
    '<span class="fav-dot' + (S.favorites.has(ch.id) ? ' faved' : '') + '">' + (S.favorites.has(ch.id) ? '&#10003;' : '+') + '</span>' +
    '<div class="card-name">' + esc(ch.name) + '</div></button>';
}

const miniHTML = (ch) => '<button class="mini focusable" data-zone="detail" data-id="' + esc(ch.id) + '">' +
  tileHTML(ch) + '<div class="card-name">' + esc(ch.name) + '</div></button>';

function rowDefs() {
  const countries = top10(S.cats.countries);
  const langs = top10(S.cats.languages);
  const defs = [];
  if (S.screen === 'live') {
    if (S.recents.length) defs.push({ title: 'Continue Watching', rid: 'recent' });
    defs.push({ title: 'Trending Now', rid: 'trend' });
    defs.push({ title: 'Live TV', rid: 'livetv', big: true });
  } else if (S.screen === 'favorites') {
    defs.push({ title: 'My List', rid: 'favs' });
  } else if (S.screen === 'recent') {
    defs.push({ title: 'Recently Watched', rid: 'recent' });
  } else if (S.screen === 'lang') {
    langs.forEach((l) => defs.push({ title: 'Top 10 in ' + esc(l.name), rid: 'l:' + l.id, big: true }));
  } else if (S.screen === 'search') {
    defs.push({ title: 'Results for "' + esc(S.search) + '"', rid: 'search' });
  }
  return defs;
}

function emptyMsg(rid) {
  if (rid === 'favs') return 'Your list is empty — click the + button on any title';
  if (rid === 'recent') return 'Nothing watched yet — play a channel to start';
  if (rid === 'search') return 'No channels found. Try another search.';
  return 'No channels available — open Settings and click Refresh Catalog';
}

async function renderRows() {
  const defs = rowDefs();
  $('#rows').innerHTML = defs.map((d) =>
    '<div class="row" data-rid="' + esc(d.rid) + '"><div class="row-title">' + d.title +
    '</div><div class="row-track">' + '<div class="card skel"></div>'.repeat(7) + '</div></div>'
  ).join('');
  if (!defs.length) $('#rows').innerHTML = '<div class="row-empty">Nothing here yet</div>';
  for (const d of defs) {
    await fillRow(d);
    tryPickHero();
  }
}

async function fillRow(d) {
  const rowEl = $('#rows .row[data-rid="' + d.rid + '"]');
  if (!rowEl) return;
  const track = $('.row-track', rowEl);
  let items = [];
  try {
    if (d.rid === 'trend') {
      if (!S.trendList) {
        const res = await api('/api/channels?limit=24');
        S.trendList = (res && res.items) || [];
      }
      items = S.trendList;
    } else if (d.rid === 'search') {
      const res = await api('/api/channels?q=' + encodeURIComponent(S.search) + '&limit=40');
      items = (res && res.items) || [];
    } else if (d.rid === 'favs' || d.rid === 'recent') {
      const ids = d.rid === 'favs' ? Array.from(S.favorites) : S.recents.map((r) => r.id);
      const missing = ids.filter((i) => !S.byId.has(i)).slice(0, 40);
      if (missing.length) {
        const res = await api('/api/channels/by-ids', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: missing })
        });
        ((res && res.items) || []).forEach((c) => S.byId.set(c.id, c));
      }
      items = d.rid === 'favs'
        ? ids.map((i) => S.byId.get(i)).filter(Boolean)
        : S.recents.map((r) => S.byId.get(r.id)).filter(Boolean);
    } else if (d.rid.slice(0, 2) === 'c:') {
      const res = await api('/api/channels?country=' + encodeURIComponent(d.rid.slice(2)) + '&limit=20');
      items = (res && res.items) || [];
    } else if (d.rid.slice(0, 2) === 'l:') {
      const res = await api('/api/channels?language=' + encodeURIComponent(d.rid.slice(2)) + '&limit=20');
      items = (res && res.items) || [];
    }
  } catch (e) {}
  if (S.settings.showSD === false) items = items.filter((c) => c.quality !== 'sd');
  items.forEach((c) => S.byId.set(c.id, c));
  track.innerHTML = items.length
    ? items.map((c, i) => cardHTML(c, d.rid, i, !!d.big)).join('')
    : '<div class="row-empty">' + esc(emptyMsg(d.rid)) + '</div>';
}

function tryPickHero() {
  if (S.heroSet) return;
  if (S.screen !== 'live' && S.screen !== 'favorites') return;
  const c = firstCardOverall();
  const ch = c && S.byId.get(c.dataset.id);
  if (ch) setHero(ch);
}

function setHero(ch) {
  if (!ch) return;
  S.hero = ch;
  S.heroSet = true;
  S.byId.set(ch.id, ch);
  $('#hero-word').style.display = 'none';
  $('#hero-title').textContent = ch.name;
  $('#hero-meta').textContent = [ch.network, ch.countryName, ch.quality ? ch.quality.toUpperCase() : ''].filter(Boolean).join(' · ');
  $('#hero-desc').textContent = (ch.not247 ? 'Not 24/7 · ' : '') +
    (ch.languageNames && ch.languageNames.length ? ch.languageNames.join(', ') + ' · ' : '') +
    ((ch.streams || []).length ? 'Live stream available' : 'No stream');
  const bg = $('#hero-bg');
  if (ch.logo) {
    bg.src = ch.logo;
    bg.style.display = '';
    bg.onerror = () => { bg.style.display = 'none'; };
  } else {
    bg.style.display = 'none';
  }
  const lg = $('#hero-logo');
  lg.style.display = ch.logo ? '' : 'none';
  if (ch.logo) lg.src = ch.logo;
  syncFavLabels();
  startHeroPreview();
}

function resetHero() {
  stopHeroPreview();
  S.hero = null;
  S.heroSet = false;
  $('#hero-word').style.display = '';
  $('#hero-title').textContent = '';
  $('#hero-meta').textContent = '';
  $('#hero-desc').textContent = '';
  $('#hero-bg').removeAttribute('src');
  $('#hero-bg').style.display = '';
  $('#hero-logo').style.display = 'none';
}

function stopHeroPreview() {
  if (S.heroTimer) { clearTimeout(S.heroTimer); S.heroTimer = null; }
  if (S.heroLoader) { S.heroLoader.destroy(); S.heroLoader = null; }
  const hv = $('#hero-video');
  hv.pause();
  hv.removeAttribute('src');
  try { hv.load(); } catch (e) {}
  hv.classList.remove('on');
}

function scheduleHeroPreview() {
  if (!S.interacted || !S.heroSet) return;
  if (S.heroTimer) clearTimeout(S.heroTimer);
  S.heroTimer = setTimeout(startHeroPreview, 1800);
}

function startHeroPreview() {
  const ch = S.hero;
  if (!ch || !heroVisible()) return;
  const s = (ch.streams || []).find((x) => x && x.url);
  if (!s) return;
  const hv = $('#hero-video');
  S.heroLoader = makeLoader(hv, s.url, {
    lowLatency: true,
    onOk() { hv.classList.add('on'); },
    onErr() { S.heroLoader = null; }
  });
}

function syncFavLabels() {
  const hf = $('#hero-fav span');
  if (hf) hf.textContent = S.hero && S.favorites.has(S.hero.id) ? 'In My List' : 'My List';
  const df = $('#d-fav span');
  if (df) df.textContent = S.detailId && S.favorites.has(S.detailId) ? 'In My List' : 'My List';
  $$('#rows .card').forEach((c) => {
    const dot = $('.fav-dot', c);
    if (!dot) return;
    const f = S.favorites.has(c.dataset.id);
    dot.classList.toggle('faved', f);
    dot.innerHTML = f ? '&#10003;' : '+';
  });
}

async function toggleFav(ch) {
  if (!ch) return;
  const res = await api('/api/favorites/toggle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: ch.id })
  });
  if (!res || !Array.isArray(res.favorites)) return;
  S.favorites = new Set(res.favorites);
  toast(res.added ? 'Added to My List' : 'Removed from My List');
  syncFavLabels();
  if (S.screen === 'favorites') renderRows();
}

async function openDetail(id) {
  if (!id) return;
  S.detailReturn = S.detailOpen ? S.detailReturn : S.focusEl;
  S.detailOpen = true;
  S.detailId = id;
  $('#overlay-detail').classList.remove('hidden');
  const fb = $('#d-fallback');
  const img = $('#d-img');
  img.removeAttribute('src');
  img.style.display = 'none';
  let ch = S.byId.get(id);
  if (!ch) {
    const res = await api('/api/channels/by-ids', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [id] })
    });
    if (res && res.items && res.items[0]) { ch = res.items[0]; S.byId.set(id, ch); }
  }
  if (!ch) {
    fb.textContent = 'Channel not found';
    $('#d-title').textContent = 'Not found';
    $('#d-meta').textContent = '';
    $('#d-desc').textContent = '';
    $('#d-row').innerHTML = '';
    setFocus($('#d-play'), $('#d-close'));
    return;
  }
  fb.textContent = ch.name;
  $('#d-title').textContent = ch.name;
  $('#d-meta').textContent = [ch.network, ch.countryName, (ch.languageNames || []).join(', ')].filter(Boolean).join(' · ');
  $('#d-desc').textContent = ch.website ? 'More info: ' + ch.website : 'Live channel from the iptv-org catalog.';
  $('#d-progress').classList.add('hidden');
  if (ch.logo) {
    img.src = ch.logo;
    img.style.display = '';
    img.onerror = () => { img.style.display = 'none'; };
  }
  syncFavLabels();
  $('#d-row').innerHTML = '<div class="mini skel"></div><div class="mini skel"></div><div class="mini skel"></div><div class="mini skel"></div>';
  let related = [];
  if (ch.country) {
    const res = await api('/api/channels?country=' + encodeURIComponent(ch.country) + '&limit=15');
    related = ((res && res.items) || []).filter((c) => c.id !== id);
  }
  if (!related.length) {
    const res = await api('/api/channels?limit=14');
    related = (res && res.items) || [];
  }
  related = related.slice(0, 14);
  related.forEach((c) => S.byId.set(c.id, c));
  if (S.detailId !== id || !S.detailOpen) return;
  $('#d-row').innerHTML = related.map(miniHTML).join('');
  if (S.focusEl) S.focusEl.classList.remove('focused');
  S.focusEl = null;
  setFocus($('#d-play'), $('#d-close'));
}

function closeDetail() {
  S.detailOpen = false;
  S.detailId = null;
  $('#overlay-detail').classList.add('hidden');
  setFocus(S.detailReturn || activePill(), $('#logo'));
  S.detailReturn = null;
}

function shareDetail() {
  const ch = S.byId.get(S.detailId);
  if (!ch) return;
  const text = 'Watch ' + ch.name + ' live on AirWave TV';
  if (navigator.share) navigator.share({ title: ch.name, text }).catch(() => {});
  else if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast('Copied to clipboard')).catch(() => {});
}

const settingsOpen = () => !$('#overlay-settings').classList.contains('hidden');

function renderSettings() {
  const st = S.status || {};
  const boxes = '<div class="stat-boxes">' +
    '<div class="stat"><b>' + (st.channels || 0) + '</b><span>Channels</span></div>' +
    '<div class="stat"><b>' + (st.streams || 0) + '</b><span>Streams</span></div>' +
    '<div class="stat"><b>' + (st.updatedAt ? new Date(st.updatedAt).toLocaleDateString() : '—') + '</b><span>Updated</span></div>' +
    '</div>';
  const rows = [
    ['autoFallback', 'Auto-Fallback', 'Try the next stream source automatically when one fails'],
    ['lowLatency', 'Low Latency', 'Prefer low-latency HLS tuning for live channels'],
    ['showSD', 'Show SD Quality', 'Include standard-definition streams in the catalog'],
    ['nsfwHidden', 'Hide Adult Content', 'Exclude NSFW-flagged channels from browsing and search']
  ].map(([key, name, desc]) => {
    const on = !!S.settings[key];
    return '<button class="sw-row focusable" data-zone="settings" data-key="' + key + '">' +
      '<div class="sw-label"><b>' + name + '</b><span>' + desc + '</span></div>' +
      '<div class="sw-toggle' + (on ? ' on' : '') + '"></div></button>';
  }).join('');
  $('#settings-dialog').innerHTML = boxes + rows +
    '<button id="btn-refresh" class="small-btn focusable" data-zone="settings">Refresh Catalog</button>';
}

function openSettings() {
  renderSettings();
  $('#overlay-settings').classList.remove('hidden');
  const first = zoneList('settings')[0];
  setFocus(first, $('#btn-settings-close'));
}

function closeSettings() {
  $('#overlay-settings').classList.add('hidden');
  const back = S.detailOpen ? zoneList('detail')[0] : activePill();
  setFocus(back, $('#logo'));
}

async function toggleSetting(key) {
  S.settings[key] = !S.settings[key];
  const res = await api('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(S.settings)
  });
  if (res) S.settings = res;
  renderSettings();
  const row = $$('#settings-dialog .sw-row').find((r) => r.dataset.key === key);
  setFocus(row, zoneList('settings')[0]);
  if (key === 'showSD') renderRows();
}

async function refreshCatalog() {
  const btn = $('#btn-refresh');
  if (btn) { btn.disabled = true; btn.textContent = 'Refreshing…'; }
  toast('Refreshing catalog…');
  let res = null;
  let conflict = false;
  try {
    const r = await fetch('/api/refresh', { method: 'POST' });
    if (r.status === 409) conflict = true;
    else if (r.ok) res = await r.json().catch(() => null);
  } catch (e) {}
  const btn2 = $('#btn-refresh');
  if (btn2) { btn2.disabled = false; btn2.textContent = 'Refresh Catalog'; }
  if (conflict) { toast('Refresh already running'); return; }
  if (!res) { toast('Refresh failed — check the server log'); return; }
  S.status = res;
  S.trendList = null;
  S.byId.clear();
  resetHero();
  const g = await api('/api/group');
  if (g) S.cats = { countries: g.countries || [], languages: g.languages || [] };
  renderSettings();
  const first = zoneList('settings')[0];
  setFocus(first, $('#btn-settings-close'));
  renderRows();
}

function openSearch() {
  $('#search-bar').classList.add('open');
  $('#search-input').focus();
}

function closeSearch() {
  $('#search-bar').classList.remove('open');
  $('#search-input').value = S.search;
  $('#search-input').blur();
  if (S.screen === 'search') switchScreen('live');
  else setFocus($('#btn-search'), activePill());
}

function switchScreen(screen) {
  if (P.open) return;
  closeDetail();
  S.screen = screen;
  $$('.nav-pill').forEach((p) => p.classList.toggle('active', p.dataset.screen === screen));
  const home = screen === 'live' || screen === 'favorites';
  $('#hero').classList.toggle('hidden-hero', !home);
  $('#search-bar').classList.toggle('open', screen === 'search');
  if (screen !== 'search') $('#search-input').value = '';
  stopHeroPreview();
  if (screen === 'search') { renderRows(); setTimeout(() => $('#search-input').focus(), 0); return; }
  renderRows();
  setFocus(activePill(), $('#logo'));
  window.scrollTo(0, 0);
}

function enhanceFocusables() {
  [['#p-back', 'panel'], ['#p-ph-back', 'panel'], ['#fs-play', 'panel'], ['#fs-mute', 'panel'],
   ['#fs-vol', 'panel'], ['#fs-stats', 'panel'], ['#fs-full', 'panel'], ['#p-bar', 'panel'],
   ['#d-close', 'detail'], ['#btn-settings-close', 'settings']].forEach(([sel, zone]) => {
    const e = $(sel);
    if (e) { e.classList.add('focusable'); e.dataset.zone = zone; }
  });
}

function bindEvents() {
  document.addEventListener('click', () => { S.interacted = true; }, { once: true });
  document.addEventListener('keydown', (e) => {
    if (P.open) { playerKeys(e); return; }
    if (document.activeElement === $('#search-input')) { searchKeys(e); return; }
    globalKeys(e);
  });
  $('#logo').addEventListener('click', () => switchScreen('live'));
  $$('.nav-pill').forEach((p) => p.addEventListener('click', () => switchScreen(p.dataset.screen)));
  $('#btn-search').addEventListener('click', openSearch);
  $('#btn-settings').addEventListener('click', openSettings);
  $('#avatar').addEventListener('click', openSettings);
  $('#search-input').addEventListener('input', (e) => {
    const v = e.target.value.trim();
    if (S.searchTimer) clearTimeout(S.searchTimer);
    S.searchTimer = setTimeout(() => {
      S.search = v;
      if (v.length >= 2) switchScreen('search');
    }, 350);
  });
  $('#hero-play').addEventListener('click', () => { if (S.hero) openPlayer(S.hero); });
  $('#hero-fav').addEventListener('click', () => toggleFav(S.hero));
  $('#hero-info').addEventListener('click', () => { if (S.hero) openDetail(S.hero.id); });
  $('#rows').addEventListener('click', (e) => {
    const dot = e.target.closest('.fav-dot');
    if (dot) {
      const card = dot.closest('.card');
      const ch = card && S.byId.get(card.dataset.id);
      if (ch) toggleFav(ch);
      return;
    }
    const c = e.target.closest('.card');
    if (c && c.dataset.id) {
      const ch = S.byId.get(c.dataset.id);
      if (ch && S.recents.includes(c.dataset.id)) {
        setHero(ch);
        return;
      }
      openDetail(c.dataset.id);
    }
  });
  $('#fs-play').addEventListener('click', togglePlay);
  $('#fs-mute').addEventListener('click', toggleMute);
  $('#fs-full').addEventListener('click', toggleFull);
  $('#fs-stats').addEventListener('click', toggleStats);
  $('#fs-vol').addEventListener('input', (e) => setVol(e.target.value / 100));
  $('#p-bar').addEventListener('click', seekClick);
  $('#p-back').addEventListener('click', closePlayer);
  $('#p-ph-back').addEventListener('click', closePlayer);
  video().addEventListener('click', togglePlay);
  video().addEventListener('play', syncVol);
  video().addEventListener('volumechange', syncVol);
  $('#d-close').addEventListener('click', closeDetail);
  $('#d-play').addEventListener('click', () => {
    const ch = S.byId.get(S.detailId);
    if (ch) { closeDetail(); openPlayer(ch); }
  });
  $('#d-fav').addEventListener('click', () => toggleFav(S.byId.get(S.detailId)));
  $('#d-share').addEventListener('click', shareDetail);
  $('#d-row').addEventListener('click', (e) => {
    const m = e.target.closest('.mini');
    if (m && m.dataset.id) openDetail(m.dataset.id);
  });
  $('#overlay-detail').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeDetail(); });
  $('#overlay-settings').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeSettings(); });
  $('#settings-dialog').addEventListener('click', (e) => {
    const row = e.target.closest('.sw-row');
    if (row && row.dataset.key) { toggleSetting(row.dataset.key); return; }
    if (e.target.closest('#btn-refresh')) refreshCatalog();
  });
  $('#btn-settings-close').addEventListener('click', closeSettings);
}

async function init() {
  enhanceFocusables();
  bindEvents();
  const [status, ud, st] = await Promise.all([
    api('/api/status'),
    api('/api/user-data'),
    api('/api/settings')
  ]);
  if (status) S.status = status;
  if (ud) {
    S.favorites = new Set(ud.favorites || []);
    S.recents = ud.recents || [];
  }
  if (st) S.settings = st;
  const g = await api('/api/group');
  S.cats = { countries: (g && g.countries) || [], languages: (g && g.languages) || [] };
  switchScreen('live');
  
  if (S.byId.has('CartoonNetworkAsia.sg')) {
    setHero(S.byId.get('CartoonNetworkAsia.sg'));
  }
}

init();
