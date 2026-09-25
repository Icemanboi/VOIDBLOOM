'use strict';

/* ------------------------------------------------------------------ *
 *  Player stats -- desktop app only
 *
 *  What goes to the VOIDBLOOM Supabase project:
 *    - an anonymous random install ID, made on first launch and kept in
 *      the app's own data folder. It is not derived from the player, the
 *      PC, an account or anything else, so it identifies an install and
 *      nothing more.
 *    - how long the app was open, actively played, and inside a run
 *    - one row per run: mode, planet, difficulty, outcome, length, level,
 *      kills, score, weapons, average fps
 *    - a small summary of the save: runs, wins, planets taken, skins...
 *    - OS, app version, language setting and graphics card, so a
 *      performance complaint can be matched to hardware
 *    - error reports: the message and line of anything that throws
 *  Never: real names, co-op callsigns, chat, file paths, IP addresses.
 *  (A leaderboard name only exists if the player types one in.)
 *
 *  How it travels. The game page never talks to Supabase: its CSP stays
 *  as tight as it was. A small tracker is injected into the page the same
 *  way the update bar is; it watches the game and passes events across the
 *  preload bridge, and this module, in the main process, checks them and
 *  does the sending. cloud.js (saves, leaderboards, news) rides on the
 *  identity and the sender defined here.
 *
 *  It must never cost the player anything: no dialogs, no stalls, nothing
 *  on screen, no error that can escape. Offline, the numbers wait in a
 *  small file in the app's data folder and go out on the next launch.
 * ------------------------------------------------------------------ */

const { app, net, ipcMain, powerMonitor } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

/* The Supabase project. The publishable key is made to ship inside apps:
   with the setup in STATS/setup.sql it can only call the vb_* functions
   that write stats or serve the game -- it cannot read a table.
   NEVER put the secret / service_role key here. */
const SUPABASE_URL = 'https://pllzzotcbjxsscukfdda.supabase.co';
const SUPABASE_KEY = 'sb_publishable_4avXCGhzdkqmVDVxWNPSHw_4x0GeI2V';

const FIRST_BEAT_MS = 15 * 1000;  // a quick look still counts as a session
const BEAT_MS = 60 * 1000;        // heartbeat while the app is open
const TICK_MS = 5 * 1000;         // time accounting
const IDLE_S = 120;               // no mouse/keyboard this long = not active
const PAGE_WAIT_MS = 400;         // longest a closing window waits for the page
const QUIT_WAIT_MS = 1800;        // longest quitting waits for the network
const REQ_TIMEOUT_MS = 10 * 1000;
const MAX_RUNS_QUEUED = 300;
const MAX_BEATS_QUEUED = 30;
const MAX_ERRORS_PER_SESSION = 25;

let ready = false;      // configured: the online features can work at all
let on = false;         // stats reporting (a player can switch this off)
let base = SUPABASE_URL;
let key = SUPABASE_KEY;
let getWin = () => null;
let install = null;
let session = null;
let startedAt = 0;
let appMs = 0;
let activeMs = 0;
let lastTick = 0;
let playBase = 0;       // play seconds from earlier page loads this session
let pagePlay = 0;       // the current page's own count
let lastPlayMove = 0;   // when play time last went up (gamepads don't reset OS idle)
let save = null;
let gpu = null;
let queue = { runs: [], beats: [] };
let flushP = null;
let finalSent = false;
let quick = false;
let errSent = 0;
const errSeen = new Set();
const hooks = { snap: null, quit: [], run: [] };

/* ------------------------------------------------------------------ setup */

function configured() {
  // A dev checkout (npm start, npm test) stays offline unless asked, so
  // testing never lands in the real numbers -- and when asked, every row
  // it sends is flagged is_dev and left out of the views and boards.
  if (!app.isPackaged) {
    if (process.env.VOIDBLOOM_STATS !== '1') return false;
    // the tests point a dev checkout at a local stand-in server
    if (process.env.VOIDBLOOM_STATS_URL) base = process.env.VOIDBLOOM_STATS_URL.replace(/\/+$/, '');
    if (process.env.VOIDBLOOM_STATS_KEY) key = process.env.VOIDBLOOM_STATS_KEY;
  }
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(base) &&
      !(!app.isPackaged && /^http:\/\/127\.0\.0\.1:\d+$/.test(base))) return false;
  return /^(sb_publishable_[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_.-]{20,})$/.test(key);
}

const dataFile = name => path.join(app.getPath('userData'), name);

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

function writeJson(file, obj) {
  // write-then-rename, so a crash mid-write can't leave half a file
  try {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj));
    fs.renameSync(tmp, file);
  } catch (e) { /* a full or read-only disk is not the player's problem */ }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function installId() {
  const f = dataFile('stats-id.json');
  const had = readJson(f);
  if (had && typeof had.id === 'string' && UUID.test(had.id)) return had.id;
  const id = crypto.randomUUID();
  writeJson(f, { id: id, made: new Date().toISOString() });
  return id;
}

function loadQueue() {
  const q = readJson(dataFile('stats-queue.json'));
  if (q && Array.isArray(q.runs) && Array.isArray(q.beats)) {
    queue.runs = q.runs.filter(r => r && typeof r === 'object').slice(-MAX_RUNS_QUEUED);
    queue.beats = q.beats.filter(b => b && typeof b === 'object').slice(-MAX_BEATS_QUEUED);
  }
}

function saveQueue() {
  writeJson(dataFile('stats-queue.json'), queue);
}

/* ANGLE reports e.g. "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504)
   Direct3D11 vs_5_0 ps_5_0, D3D11)". Keep just the card. */
function cleanGpu(s) {
  if (typeof s !== 'string' || !s) return null;
  let t = s.replace(/^ANGLE \(/, '').replace(/\)\s*$/, '');
  const parts = t.split(', ');
  if (parts.length >= 2) t = parts[1];
  t = t.replace(/\(0x[0-9a-f]+\)/ig, '')
       .replace(/Direct3D\S*|vs_\S+|ps_\S+|ANGLE Metal Renderer:\s*/g, '')
       .replace(/\s+/g, ' ').trim();
  return t.slice(0, 96) || null;
}

/* ---------------------------------------------------------- time keeping */

function tick() {
  const now = Date.now();
  let dt = now - lastTick;
  lastTick = now;
  // a timer that fires very late means the machine slept (or the clock
  // jumped): count one tick at most, never the gap
  if (!(dt > 0)) return;
  if (dt > 3 * TICK_MS) dt = TICK_MS;
  appMs += dt;

  const w = getWin();
  if (!w || w.isDestroyed() || !w.isVisible() || w.isMinimized() || !w.isFocused()) return;
  let idle = 0;
  try { idle = powerMonitor.getSystemIdleTime(); } catch (e) { }
  // a gamepad doesn't reset the OS idle clock, so a live run counts as active
  if (idle < IDLE_S || now - lastPlayMove < 15000) activeMs += dt;
}

/* ------------------------------------------------------------- payloads */

const RUN_KEYS = {
  mode: 's', difficulty: 's', planet: 's', outcome: 's', seconds: 'n', level: 'n',
  kills: 'n', score: 'n', tide: 'n', boss_kills: 'n', depth: 'n', act2: 'b',
  weapons: 'a', evolved: 'n', skin: 's', pet: 's', dmg_dealt: 'n', dmg_taken: 'n',
  avg_fps: 'n', at: 'n', day: 's'
};
const SAVE_KEYS = {
  runs: 'n', wins: 'n', kills: 'n', best: 'n', best_time: 'n', shards: 'n',
  skins: 'n', pets: 'n', achs: 'n', planets: 'n', bosses: 'n', coop_runs: 'n',
  skin: 's', pet: 's'
};
const ERR_KEYS = {
  kind: 's', message: 's', source: 's', line: 'n', col: 'n', stack: 's', state: 's'
};

// only known keys, only the expected type, nothing long
function pick(src, spec, long) {
  const out = {};
  if (!src || typeof src !== 'object') return out;
  for (const k of Object.keys(spec)) {
    const v = src[k], t = spec[k];
    if (t === 's' && typeof v === 'string') out[k] = v.slice(0, long && long[k] || 40);
    else if (t === 'n' && typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (t === 'b' && typeof v === 'boolean') out[k] = v;
    else if (t === 'a' && Array.isArray(v)) {
      out[k] = v.filter(x => typeof x === 'string').slice(0, 12).map(x => x.slice(0, 24));
    }
  }
  return out;
}

function who() {
  return { install_id: install, session_id: session, version: app.getVersion(), dev: !app.isPackaged };
}

function beat(ended) {
  const b = Object.assign(who(), {
    started: startedAt,
    platform: process.platform,
    arch: process.arch,
    os: os.release(),
    locale: app.getLocale(),
    app_s: Math.round(appMs / 1000),
    active_s: Math.round(activeMs / 1000),
    play_s: Math.round(playBase + pagePlay),
    ended: !!ended
  });
  if (gpu) b.gpu = gpu;
  if (save) b.save = save;
  // beats carry running totals, so only the newest one per session matters
  queue.beats = queue.beats.filter(x => x.session_id !== session);
  queue.beats.push(b);
  if (queue.beats.length > MAX_BEATS_QUEUED) queue.beats.splice(0, queue.beats.length - MAX_BEATS_QUEUED);
}

function onPageTick(d) {
  if (!d || typeof d !== 'object') return;
  const p = Number(d.play_s);
  if (Number.isFinite(p) && p >= 0 && p < 1e7) {
    if (p < pagePlay) playBase += pagePlay;   // the page reloaded and started again from 0
    if (p > pagePlay) lastPlayMove = Date.now();
    pagePlay = p;
  }
  if (d.save && typeof d.save === 'object') save = pick(d.save, SAVE_KEYS);
  if (!gpu && typeof d.gpu === 'string') gpu = cleanGpu(d.gpu.slice(0, 200));
}

function queueRun(d) {
  const r = Object.assign(pick(d, RUN_KEYS), who(), { run_id: crypto.randomUUID() });
  queue.runs.push(r);
  if (queue.runs.length > MAX_RUNS_QUEUED) queue.runs.splice(0, queue.runs.length - MAX_RUNS_QUEUED);
  return r;
}

function onRun(d) {
  const r = queueRun(d);
  saveQueue();
  flush();
  for (const fn of hooks.run) { try { fn(r); } catch (e) { } }
}

// An error report goes straight out, once per distinct error per session,
// and never more than a couple of dozen of them: a loop that throws every
// frame must not turn into a flood.
function report(d) {
  if (!on || !d || typeof d !== 'object') return;
  const e = pick(d, ERR_KEYS, { message: 300, source: 120, stack: 2000, state: 24 });
  const k = (e.kind || '') + '|' + (e.message || '') + '|' + (e.line || 0);
  if (errSeen.has(k) || errSent >= MAX_ERRORS_PER_SESSION) return;
  errSeen.add(k); errSent++;
  // a file path in a stack trace is the one place a user name could hide
  if (e.stack) e.stack = e.stack.replace(/[A-Za-z]:\\Users\\[^\\]+/g, 'C:\\Users\\*').replace(/\/(Users|home)\/[^/]+/g, '/$1/*');
  if (e.source) e.source = e.source.replace(/[A-Za-z]:\\Users\\[^\\]+/g, 'C:\\Users\\*').replace(/\/(Users|home)\/[^/]+/g, '/$1/*');
  rpc('vb_error', Object.assign(e, { install_id: install, version: app.getVersion() }));
}

/* ------------------------------------------------------------- sending */

function timeout(ms) {
  return new Promise(resolve => setTimeout(() => resolve('timeout'), ms));
}

function headers() {
  const h = { 'apikey': key, 'Content-Type': 'application/json' };
  // legacy anon keys are JWTs and also go in Authorization; the new
  // publishable keys must not
  if (key.startsWith('eyJ')) h['Authorization'] = 'Bearer ' + key;
  return h;
}

// For the fire-and-forget writes:
// 'ok' | 'drop' (the request itself is bad; resending won't help) | 'retry'
async function rpc(fn, p) {
  try {
    const res = await Promise.race([
      net.fetch(base + '/rest/v1/rpc/' + fn, { method: 'POST', headers: headers(), body: JSON.stringify({ p: p }) }),
      timeout(REQ_TIMEOUT_MS)
    ]);
    if (res === 'timeout') return 'retry';
    if (res.ok) return 'ok';
    if (res.status === 400 || res.status === 413 || res.status === 422) return 'drop';
    return 'retry';
  } catch (e) {
    return 'retry';
  }
}

// For calls whose answer matters (cloud.js): { ok, data } or { ok:false, error }
async function call(fn, p, ms) {
  if (!ready) return { ok: false, error: 'off' };
  try {
    const body = p === undefined ? '{}' : JSON.stringify({ p: p });
    const res = await Promise.race([
      net.fetch(base + '/rest/v1/rpc/' + fn, { method: 'POST', headers: headers(), body: body }),
      timeout(ms || REQ_TIMEOUT_MS)
    ]);
    if (res === 'timeout') return { ok: false, error: 'offline' };
    if (!res.ok) return { ok: false, error: res.status >= 500 || res.status === 0 ? 'offline' : 'server', status: res.status };
    let data = null;
    try { data = await res.json(); } catch (e) { }
    return { ok: true, data: data };
  } catch (e) {
    return { ok: false, error: 'offline' };
  }
}

async function doFlush() {
  let changed = false;
  // Beats first -- a beat is what creates the session a run belongs to,
  // which matters for anything saved up while offline. Oldest first;
  // stop at the first network failure and try again next minute.
  let down = false;
  for (const b of queue.beats.slice()) {
    const res = await rpc('vb_beat', b);
    if (res === 'retry') { down = true; break; }
    const i = queue.beats.indexOf(b);
    if (i >= 0) { queue.beats.splice(i, 1); changed = true; }
  }
  while (!down && queue.runs.length) {
    const res = await rpc('vb_run', queue.runs[0]);
    if (res === 'retry') break;
    queue.runs.shift(); changed = true;
  }
  // the current session's beat is rebuilt every minute; only a backlog of
  // runs or earlier sessions' beats is worth keeping on disk
  if (changed) saveQueue();
}

// one flush at a time; a caller that arrives mid-flush waits for that one
function flush() {
  if (!on) return Promise.resolve();
  if (flushP) return flushP;
  flushP = doFlush().catch(() => { }).finally(() => { flushP = null; });
  return flushP;
}

/* ------------------------------------------------------- the page side */

/* Runs inside the game page (the main world, where window.VOIDBLOOM lives).
   It is stringified and injected, never required -- so it may only use what
   the page has. It wraps a handful of the game's own functions and
   otherwise only reads. Every wrapper calls the original first-class and
   swallows its own errors, so a bug here can never break the game. */
function tracker() {
  if (window.__vbStatsOn || !window.vbStats) return;
  window.__vbStatsOn = true;

  var send = function (kind, data) { try { window.vbStats.post(kind, data); } catch (e) { } };
  var LIVE = { playing: 1, levelup: 1, covenant: 1 };            // a run on screen, not paused
  var IN_RUN = { playing: 1, levelup: 1, covenant: 1, paused: 1, settings: 1 };
  var run = null, playS = 0, last = performance.now(), hooked = false;

  var V = function () { return window.VOIDBLOOM; };

  /* ---- error reports: anything that throws, and console.error lines */
  var stateNow = function () { try { return String(V().Game.state || ''); } catch (e) { return ''; } };
  window.addEventListener('error', function (e) {
    try {
      send('error', { kind: 'page', message: String(e.message || 'error'), source: String(e.filename || ''),
        line: +e.lineno || 0, col: +e.colno || 0, stack: String((e.error && e.error.stack) || ''), state: stateNow() });
    } catch (x) { }
  });
  window.addEventListener('unhandledrejection', function (e) {
    try {
      var r = e.reason;
      send('error', { kind: 'page', message: 'unhandled: ' + String((r && r.message) || r),
        stack: String((r && r.stack) || ''), state: stateNow() });
    } catch (x) { }
  });
  try {
    var ce = console.error;
    console.error = function () {
      try {
        var a0 = arguments[0];
        send('error', { kind: 'console', message: String(a0 && a0.message ? a0.message : a0).slice(0, 300),
          stack: String((a0 && a0.stack) || ''), state: stateNow() });
      } catch (x) { }
      return ce.apply(this, arguments);
    };
  } catch (e) { }

  function modeOf(G) {
    if (G.coop) return 'coop';
    if (G.D && G.D.daily) return 'daily';
    if (G.planet) return 'conquest';
    if (G.endless) return 'endless';
    return 'skirmish';
  }

  function open(act2) {
    var G = V().Game;
    run = {
      mode: modeOf(G),
      difficulty: String(G.diff || ''),
      planet: G.planet ? String(G.planet.name || G.planet.id || '') : null,
      day: G.D && G.D.daily ? String(G.dayKey || '') : null,
      act2: !!act2,
      fpsSum: 0, fpsN: 0
    };
  }

  function close(outcome, quiet) {
    var r = run; run = null;
    var v = V(); if (!r || !v || !v.Game) return null;
    var G = v.Game, C = v.Coop;
    var rs = G.runStats || {}, ws = G.weapons || [], ids = [], ev = 0;
    for (var i = 0; i < ws.length && i < 12; i++) {
      if (!ws[i]) continue;
      ids.push(String(ws[i].id) + (ws[i].evolved ? '*' : ''));
      if (ws[i].evolved) ev++;
    }
    var coop = r.mode === 'coop' && C;
    var d = (v.Save && v.Save.data) || {};
    var out = {
      mode: r.mode, difficulty: r.difficulty, planet: r.planet, outcome: outcome,
      // the whole run's clock, act II included: the score is the whole run's too
      seconds: Math.max(0, Math.round((+G.time || 0) * 10) / 10),
      level: +G.level || 0,
      kills: coop && C.stats ? (+C.stats.kills || 0) : (+G.kills || 0),
      score: Math.round(+G.score || 0),
      tide: +G.tide || 0,
      boss_kills: +rs.bossKills || 0,
      act2: r.act2,
      weapons: ids, evolved: ev,
      dmg_dealt: Math.round(+rs.dmgDealt || 0),
      dmg_taken: Math.round(+rs.dmgTaken || 0),
      at: Date.now()
    };
    if (r.day) out.day = r.day;
    if (coop) out.depth = +C.depth || 0;
    if (typeof d.skin === 'string') out.skin = d.skin;
    if (typeof d.pet === 'string') out.pet = d.pet;
    if (r.fpsN) out.avg_fps = Math.round(r.fpsSum / r.fpsN * 10) / 10;
    if (!quiet) {
      send('run', out);
      // the save has just changed: offer it to the cloud backup a beat later,
      // once the game has written it
      setTimeout(function () { sendSnap(true); }, 1500);
    }
    return out;
  }

  function saveSummary() {
    var v = V(), d = v && v.Save && v.Save.data;
    if (!d) return null;
    var count = function (o) { var n = 0; if (o && typeof o === 'object') for (var k in o) if (o[k]) n++; return n; };
    var s = {
      runs: +d.runs || 0, wins: +d.wins || 0, kills: +d.kills || 0,
      best: +d.best || 0, best_time: +d.bestTime || 0, shards: +d.shards || 0,
      skins: Array.isArray(d.owned) ? d.owned.length : 0,
      pets: Array.isArray(d.pets) ? d.pets.length : 0,
      achs: count(d.achs),
      planets: count(d.conquest && d.conquest.conquered),
      bosses: count(d.bossSeen),
      coop_runs: (d.coop && +d.coop.runs) || 0
    };
    if (typeof d.skin === 'string') s.skin = d.skin;
    if (typeof d.pet === 'string') s.pet = d.pet;
    return s;
  }

  /* ---- the save, for the cloud backup: every voidbloom.* key but the
     two that only make sense on this machine */
  var lastSnap = '';
  function snapshot() {
    var data = {};
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k || k.indexOf('voidbloom.') !== 0 || k === 'voidbloom.server' || k === 'voidbloom.wake') continue;
        data[k] = localStorage.getItem(k);
      }
    } catch (e) { return null; }
    return data;
  }
  function sendSnap(force) {
    try {
      var data = snapshot();
      if (!data) return;
      var s = JSON.stringify(data);
      if (s.length > 120000 || (!force && s === lastSnap)) return;
      lastSnap = s;
      send('snap', { data: data, summary: saveSummary() });
    } catch (e) { }
  }

  function wrap(obj, name, before, after) {
    var orig = obj && obj[name];
    if (typeof orig !== 'function' || orig.__vbStats) return;
    var w = function () {
      var pre;
      try { if (before) pre = before.apply(this, arguments); } catch (e) { }
      var out = orig.apply(this, arguments);
      try { if (after) after.call(this, pre, arguments); } catch (e) { }
      return out;
    };
    w.__vbStats = true;
    obj[name] = w;
  }

  function hook() {
    if (hooked) return true;
    var v = V();
    if (!v || !v.Game) return false;
    var G = v.Game;
    // a new run -- and if one was still going, it was abandoned
    wrap(G, 'reset', function () { if (run) close('quit'); }, function () { open(false); });
    wrap(G, 'gameOver', function () { return !!G.over; },
      function (was, args) { if (!was && run) close(args[0] ? 'win' : 'dead'); });
    // PRESS ON and DESCEND DEEPER: the first act already ended as a win;
    // what follows is its own run, carrying the same clock and score
    wrap(G, 'pressOn', null, function () { if (!run) open(true); });
    wrap(G, 'goEndless', null, function () { if (!run) open(true); });
    if (v.Coop) {
      wrap(v.Coop, 'finish', function () { return !!v.Coop.over; },
        function (was, args) { if (!was && run) close(args[0] ? 'win' : 'dead'); });
    }
    hooked = true;
    return true;
  }

  // The graphics card, read from a WebGL context the game has ALREADY made.
  // Never call getContext here: the game makes its contexts lazily, and a
  // canvas keeps whichever context type and options are asked for first --
  // getting in ahead of the game would break its sky or its bloom for good.
  var gpuName, gpuTries = 0;
  function gpu() {
    if (gpuName !== undefined || gpuTries > 30) return gpuName || null;
    gpuTries++;
    try {
      var v = V();
      var gl = (v.Cosmos && v.Cosmos.gl) || (v.FX && v.FX.gl);
      if (!gl || typeof gl.getExtension !== 'function') return null;
      var ext = gl.getExtension('WEBGL_debug_renderer_info');
      gpuName = ext ? (String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '').slice(0, 200) || null) : null;
    } catch (e) { gpuName = null; }
    return gpuName;
  }

  function tickMsg() { return { play_s: Math.round(playS), live: !!run, save: saveSummary(), gpu: gpu() }; }

  setInterval(function () {
    var now = performance.now(), dt = (now - last) / 1000;
    last = now;
    if (!(dt > 0)) return;
    if (dt > 5) dt = 5;          // the machine slept; don't count the gap
    try {
      if (!hook()) return;
      var v = V(), G = v.Game, st = G.state;
      if (LIVE[st]) {
        playS += dt;
        if (run && typeof v.fps === 'function') {
          var f = +v.fps();
          if (f > 0 && f < 1000) { run.fpsSum += f; run.fpsN++; }
        }
      }
      // back on a menu without the run ending: ABANDON RUN, MAIN MENU,
      // leaving a co-op lobby mid-run
      if (run && !IN_RUN[st] && !G.over) close('quit');
    } catch (e) { }
  }, 1000);

  setInterval(function () { try { send('tick', tickMsg()); } catch (e) { } }, 10000);
  // shop purchases and settings change the save outside a run too
  setInterval(function () { if (!run) sendSnap(false); }, 120000);

  // Called by the app as the window closes: an unfinished run counts as
  // abandoned, and the latest totals and save go back in the answer itself.
  window.__vbStatsFlush = function () {
    var r = null;
    // quiet: the run travels back in this return value, not as a message too
    try { if (run) r = close('quit', true); } catch (e) { }
    var sn = null;
    try { var d = snapshot(); if (d && JSON.stringify(d).length <= 120000) sn = { data: d, summary: saveSummary() }; } catch (e) { }
    return { tick: tickMsg(), run: r, snap: sn };
  };

  hook();
}

/* -------------------------------------------------------------- public */

function inject(wc) {
  if (!ready || !wc || wc.isDestroyed()) return;
  wc.executeJavaScript('(' + tracker.toString() + ')();').catch(() => { });
}

// ask the page for its last numbers (and save) before it goes; never wait long
async function grabPage(wc) {
  if (!ready || !wc || wc.isDestroyed()) return null;
  try {
    const r = await Promise.race([
      wc.executeJavaScript('window.__vbStatsFlush ? window.__vbStatsFlush() : null'),
      timeout(PAGE_WAIT_MS)
    ]);
    if (r && typeof r === 'object') {
      if (on && r.tick) onPageTick(r.tick);
      if (on && r.run) queueRun(r.run);
      return r.snap || null;
    }
  } catch (e) { }
  return null;
}

function watchWindow(w) {
  if (!ready || !w) return;
  let grabbed = false;
  w.on('close', (e) => {
    // Already quitting (Cmd+Q, the update restart): the quit handler has
    // taken the page's numbers. Holding a window open now would cancel the
    // quit outright -- Electron aborts a quit if any window refuses to close.
    if (grabbed || quick || finalSent) return;
    grabbed = true;
    e.preventDefault();
    grabPage(w.webContents)
      .then(snap => { if (snap && hooks.snap) hooks.snap(snap, true); })
      .catch(() => { })
      .finally(() => { if (!w.isDestroyed()) w.close(); });
  });
  // the renderer dying is the one crash the page can't report itself
  w.webContents.on('render-process-gone', (_e, d) => {
    report({ kind: 'crash', message: 'renderer gone: ' + (d && d.reason) + ' (exit ' + (d && d.exitCode) + ')' });
  });
  w.on('unresponsive', () => { report({ kind: 'crash', message: 'window unresponsive' }); });
}

// The update bar's RESTART: don't hold up the installer. The final numbers
// go to disk and out on the next launch.
function quickQuit() { quick = true; }

/* Restoring a cloud save on this PC makes it the same player as the PC the
   save came from: the old session is closed under the old ID, and a fresh
   session starts under the adopted one. */
async function adopt(id) {
  if (!ready || typeof id !== 'string' || !UUID.test(id) || id === install) return;
  if (on) { tick(); beat(true); await flush(); }
  install = id;
  writeJson(dataFile('stats-id.json'), { id: id, adopted: new Date().toISOString() });
  session = crypto.randomUUID();
  startedAt = Date.now(); lastTick = startedAt;
  appMs = activeMs = playBase = pagePlay = 0;
}

function start(winGetter) {
  ready = configured();
  if (!ready) return;
  on = !process.env.VOIDBLOOM_NO_STATS;
  getWin = winGetter;
  install = installId();
  session = crypto.randomUUID();
  startedAt = Date.now();
  lastTick = startedAt;
  if (on) loadQueue();

  ipcMain.on('vb-stats', (e, kind, data) => {
    try {
      const url = e.senderFrame ? e.senderFrame.url : '';
      if (!/^voidbloom:\/\/app\//.test(url)) return;
      if (kind === 'snap') { if (hooks.snap && data && typeof data === 'object') hooks.snap(data, false); return; }
      if (JSON.stringify(data || null).length > 8000) return;
      if (kind === 'error') { report(data); return; }
      if (!on) return;
      if (kind === 'tick') onPageTick(data);
      else if (kind === 'run') onRun(data);
    } catch (err) { }
  });

  if (!on) {
    app.on('before-quit', (e) => { quitWith(e, false); });
    return;
  }

  try {
    powerMonitor.on('resume', () => { lastTick = Date.now(); });
  } catch (e) { }

  app.getGPUInfo('complete')
    .then(i => { gpu = cleanGpu(i && i.auxAttributes && i.auxAttributes.glRenderer); })
    .catch(() => { });

  setInterval(tick, TICK_MS);
  setTimeout(() => { tick(); beat(false); flush(); }, FIRST_BEAT_MS);
  setInterval(() => { tick(); beat(false); flush(); }, BEAT_MS);
  // anything left over from last time
  setTimeout(flush, 4000);

  app.on('before-quit', (e) => { quitWith(e, true); });
}

function quitWith(e, stats) {
  if (finalSent) return;
  finalSent = true;
  if (stats) {
    tick();
    beat(true);
    saveQueue();                      // on disk first, whatever happens next
  }
  if (quick) return;
  e.preventDefault();
  const w = getWin();
  const page = (w && !w.isDestroyed()) ? grabPage(w.webContents) : Promise.resolve(null);
  Promise.race([
    page.then(snap => {
      const jobs = [];
      if (stats) { beat(true); jobs.push(flush()); }
      if (snap && hooks.snap) jobs.push(Promise.resolve(hooks.snap(snap, true)));
      for (const fn of hooks.quit) { try { jobs.push(Promise.resolve(fn())); } catch (x) { } }
      return Promise.all(jobs);
    }),
    timeout(QUIT_WAIT_MS)
  ]).catch(() => { }).finally(() => { if (stats) saveQueue(); app.quit(); });
}

module.exports = {
  start, inject, watchWindow, quickQuit, adopt, flush, call,
  isReady: () => ready,
  identity: () => ({ install_id: install, version: app.getVersion(), dev: !app.isPackaged }),
  onSnap: fn => { hooks.snap = fn; },
  onQuit: fn => { hooks.quit.push(fn); },
  onRunQueued: fn => { hooks.run.push(fn); },
  _test: { cleanGpu, pick, tracker }
};
