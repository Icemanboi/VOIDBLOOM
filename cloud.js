'use strict';

/* ------------------------------------------------------------------ *
 *  Online features -- desktop app only
 *
 *    CLOUD SAVE   A save code (VB-XXXX-XXXX-XXXX) backs the save up to
 *                 Supabase. After the first backup it keeps itself up to
 *                 date after every run and on quit. On a new PC, RESTORE
 *                 + the code brings everything back.
 *    LEADERBOARDS Skirmish per difficulty, Endless and the Daily, built on
 *                 the server from the run reports stats.js already sends.
 *    NAMES        The name a player chooses for the boards. Checked on the
 *                 server (format, rude words, taken).
 *    LIVE         News and events (double shards...) posted from the
 *                 dashboard, shown on the title screen.
 *
 *  The game reaches all of this through window.vbCloud.call(op, args)
 *  (preload.js), which lands here. The page still never touches the
 *  network: this module does, with the same identity and key as stats.js.
 *  The game only shows its online screens when window.vbCloud exists, so
 *  the itch and CrazyGames builds look exactly as they always have.
 * ------------------------------------------------------------------ */

const { app, ipcMain, clipboard } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const stats = require('./stats');

const AUTO_EVERY_MS = 90 * 1000;       // automatic backups: at most this often
const LIVE_EVERY_MS = 10 * 60 * 1000;  // news / events refresh
const ME_EVERY_MS = 60 * 1000;
const CODE_RE = /^VB-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/;

let state = { code: null, savedAt: null, hash: null };
let me = { name: null, hidden: false, banned: false, at: 0 };
let live = null, liveAt = 0, liveP = null;
let lastAuto = 0;
let uploading = null;          // the backup in flight, so quitting can wait for it
let nextSnap = null;           // an automatic backup that arrived while throttled

const file = () => path.join(app.getPath('userData'), 'cloud.json');

function load() {
  try {
    const s = JSON.parse(fs.readFileSync(file(), 'utf8'));
    if (s && typeof s.code === 'string' && CODE_RE.test(s.code)) state = { code: s.code, savedAt: s.savedAt || null, hash: s.hash || null };
  } catch (e) { }
}

function persist() {
  try {
    const tmp = file() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, file());
  } catch (e) { }
}

const hashOf = data => crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 24);

// what the page may hand us as a save: voidbloom.* string values, nothing else
function cleanSnap(s) {
  if (!s || typeof s !== 'object' || !s.data || typeof s.data !== 'object') return null;
  const data = {};
  let size = 0;
  for (const k of Object.keys(s.data)) {
    const v = s.data[k];
    if (!/^voidbloom\.[A-Za-z0-9_.-]{1,40}$/.test(k) || typeof v !== 'string') continue;
    if (k === 'voidbloom.server' || k === 'voidbloom.wake') continue;
    size += k.length + v.length;
    data[k] = v;
  }
  if (!Object.keys(data).length || size > 120000) return null;
  const sum = {};
  if (s.summary && typeof s.summary === 'object') {
    for (const k of ['runs', 'wins', 'shards', 'skins', 'pets', 'achs', 'planets', 'best']) {
      const v = s.summary[k];
      if (typeof v === 'number' && Number.isFinite(v)) sum[k] = v;
    }
  }
  return { data: data, summary: sum };
}

async function backup(snap, create) {
  const s = cleanSnap(snap);
  if (!s) return { ok: false, error: 'data' };
  const id = stats.identity();
  let r;
  if (!state.code || create) {
    r = await stats.call('vb_save_create', { install_id: id.install_id, data: s.data, summary: s.summary });
    if (r.ok && r.data && r.data.ok && CODE_RE.test(r.data.code)) {
      state = { code: r.data.code, savedAt: r.data.saved_at, hash: hashOf(s.data) };
      persist();
      return { ok: true, code: state.code, savedAt: state.savedAt, created: true };
    }
  } else {
    r = await stats.call('vb_save_put', { code: state.code, data: s.data, summary: s.summary });
    if (r.ok && r.data && r.data.ok) {
      state.savedAt = r.data.saved_at; state.hash = hashOf(s.data);
      persist();
      return { ok: true, code: state.code, savedAt: state.savedAt };
    }
    // the code no longer exists on the server (made again on another PC):
    // stop backing up to it rather than failing forever
    if (r.ok && r.data && r.data.error === 'unknown') {
      state = { code: null, savedAt: null, hash: null };
      persist();
      return { ok: false, error: 'lost' };
    }
  }
  return { ok: false, error: r.ok ? ((r.data && r.data.error) || 'server') : r.error };
}

// automatic backups: only once there is a code, only when something changed,
// never more often than every minute and a half (the last one always lands)
function auto(snap, final) {
  if (!state.code) return null;
  const s = cleanSnap(snap);
  if (!s || hashOf(s.data) === state.hash) return null;
  const now = Date.now();
  if (!final && now - lastAuto < AUTO_EVERY_MS) {
    const later = !nextSnap;
    nextSnap = snap;
    if (later) setTimeout(() => { const n = nextSnap; nextSnap = null; if (n) auto(n, false); }, AUTO_EVERY_MS - (now - lastAuto) + 50);
    return null;
  }
  lastAuto = now;
  nextSnap = null;
  uploading = backup(snap, false).finally(() => { uploading = null; });
  return uploading;
}

async function refreshMe(force) {
  if (!force && Date.now() - me.at < ME_EVERY_MS) return me;
  const r = await stats.call('vb_me', { install_id: stats.identity().install_id }, 6000);
  if (r.ok && r.data && r.data.ok) me = { name: r.data.name || null, hidden: !!r.data.hidden, banned: !!r.data.banned, at: Date.now() };
  return me;
}

function refreshLive(force) {
  if (!force && live && Date.now() - liveAt < LIVE_EVERY_MS) return Promise.resolve(live);
  if (liveP) return liveP;
  liveP = stats.call('vb_live', undefined, 6000).then(r => {
    if (r.ok && r.data && typeof r.data === 'object') { live = cleanLive(r.data); liveAt = Date.now(); }
    return live;
  }).finally(() => { liveP = null; });
  return liveP;
}

// the page gets plain, bounded values only
function cleanLive(d) {
  const str = (v, n) => typeof v === 'string' ? v.slice(0, n) : null;
  const out = { now: str(d.now, 40), news: null, events: [], next: null };
  if (d.news && typeof d.news === 'object') {
    out.news = { id: +d.news.id || 0, title: str(d.news.title, 60), body: str(d.news.body, 180),
                 color: /^#[0-9a-fA-F]{6}$/.test(d.news.color || '') ? d.news.color : null };
  }
  if (Array.isArray(d.events)) {
    for (const e of d.events.slice(0, 4)) {
      const m = Number(e && e.mult);
      if (!e || e.kind !== 'shards' || !(m > 1 && m <= 5)) continue;
      out.events.push({ kind: 'shards', mult: m, title: str(e.title, 40), ends_at: str(e.ends_at, 40) });
    }
  }
  if (d.next && typeof d.next === 'object') out.next = { title: str(d.next.title, 40), mult: Number(d.next.mult) || 0, starts_at: str(d.next.starts_at, 40) };
  return out;
}

const BOARDS = { skirmish: 1, endless: 1, daily: 1 };
const DIFFS = { easy: 1, medium: 1, hard: 1, impossible: 1, hardcore: 1 };

async function handle(op, a) {
  a = a && typeof a === 'object' ? a : {};
  switch (op) {
    case 'status': {
      await refreshMe(false).catch(() => { });
      return { ok: true, code: state.code, savedAt: state.savedAt, name: me.name, hidden: me.hidden, banned: me.banned };
    }
    case 'backup':               // SAVE NOW / CREATE: the page hands us its save
      return backup(a, !state.code);
    case 'newcode':              // replace the code (the old one stops working)
      return backup(a, true);
    case 'lookup': {             // RESTORE, step 1: what's behind this code?
      const code = String(a.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const r = await stats.call('vb_save_get', { code: code });
      if (!r.ok) return { ok: false, error: r.error };
      const d = r.data || {};
      if (!d.ok) return { ok: false, error: d.error || 'unknown' };
      const snap = cleanSnap({ data: d.data });
      if (!snap) return { ok: false, error: 'data' };
      return { ok: true, code: d.code, savedAt: d.saved_at, summary: d.summary || {}, data: snap.data, installId: d.install_id };
    }
    case 'adopt': {              // RESTORE, step 2: this PC becomes that player
      if (!CODE_RE.test(String(a.code || ''))) return { ok: false, error: 'code' };
      state = { code: a.code, savedAt: a.savedAt || null, hash: null };
      persist();
      await stats.adopt(String(a.installId || ''));
      me.at = 0;
      return { ok: true };
    }
    case 'board': {
      const board = BOARDS[a.board] ? a.board : 'skirmish';
      const diff = DIFFS[a.diff] ? a.diff : 'medium';
      await stats.flush();          // the run that just ended should be on it
      const r = await stats.call('vb_board', { board: board, diff: diff, period: a.period === 'all' ? 'all' : 'week',
        limit: Math.max(1, Math.min(50, +a.limit || 10)), install_id: stats.identity().install_id });
      if (!r.ok) return { ok: false, error: r.error };
      return r.data && r.data.ok ? r.data : { ok: false, error: (r.data && r.data.error) || 'server' };
    }
    case 'name': {
      const r = await stats.call('vb_name_set', { install_id: stats.identity().install_id, name: String(a.name || '').slice(0, 24) });
      if (!r.ok) return { ok: false, error: r.error };
      if (r.data && r.data.ok) { me.name = r.data.name; me.hidden = false; me.at = Date.now(); }
      return r.data || { ok: false, error: 'server' };
    }
    case 'hide': {
      const r = await stats.call('vb_name_hide', { install_id: stats.identity().install_id, hidden: !!a.hidden });
      if (r.ok && r.data && r.data.ok) me.hidden = !!r.data.hidden;
      return r.ok ? (r.data || { ok: false }) : { ok: false, error: r.error };
    }
    case 'live':
      return { ok: true, live: await refreshLive(!!a.force).catch(() => live) };
    case 'copy': {
      const t = String(a.text || '');
      if (!CODE_RE.test(t)) return { ok: false };
      clipboard.writeText(t);
      return { ok: true };
    }
  }
  return { ok: false, error: 'op' };
}

function start() {
  // the preload asks this once, before the page loads: with no server to talk
  // to (a dev checkout), the page never gets vbCloud and draws no online screens
  ipcMain.on('vb-cloud-ready', e => { e.returnValue = stats.isReady(); });
  if (!stats.isReady()) return;
  load();
  stats.onSnap((snap, final) => auto(snap, final));
  stats.onQuit(() => uploading);
  ipcMain.handle('vb-cloud', async (e, op, args) => {
    try {
      const url = e.senderFrame ? e.senderFrame.url : '';
      if (!/^voidbloom:\/\/app\//.test(url)) return { ok: false, error: 'origin' };
      if (JSON.stringify(args || null).length > 200000) return { ok: false, error: 'big' };
      return await handle(String(op), args);
    } catch (err) {
      return { ok: false, error: 'client' };
    }
  });
  // news and events before anyone opens the title screen
  setTimeout(() => { refreshLive(true).catch(() => { }); }, 2500);
  setInterval(() => { refreshLive(true).catch(() => { }); }, LIVE_EVERY_MS);
}

module.exports = { start, _test: { cleanSnap, cleanLive, CODE_RE } };
