/* Play-stats test. Boots the real app with stats switched on, pointed at a
   stand-in for Supabase on 127.0.0.1 (nothing leaves the machine), plays a
   scripted session through the game's own functions, closes the window the
   way a player does, and checks exactly what arrived:

     - the tracker hooked the game and the game logged no errors
     - five runs, each with the right mode / planet / outcome:
         medium skirmish -> dead
         easy skirmish abandoned from the pause menu (after a visit to
           SETTINGS, which must NOT count as leaving the run) -> quit
         conquest planet -> win, then PRESS ON -> an act II run -> dead
         endless run still going when the window closes -> quit
     - a heartbeat, and a final one marked ended with play time counted
     - every request carried the publishable key in `apikey` and nothing in
       Authorization

   Run: xvfb-run -a node test/statsrun.js      (about a minute)            */
'use strict';

const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const electron = require('electron');

const ROOT = path.join(__dirname, '..');
const KEY = 'sb_publishable_statsruntest0000';
const got = [];
const problems = [];

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', d => { body += d; });
  req.on('end', () => {
    let p = null;
    try { p = JSON.parse(body).p; } catch (e) { }
    got.push({ url: req.url, apikey: req.headers.apikey, auth: req.headers.authorization, p: p });
    res.writeHead(204); res.end();
  });
});

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-stats-'));
  const child = spawn(electron, ['--no-sandbox', '--enable-unsafe-swiftshader', '--user-data-dir=' + ud,
    '-r', path.join(__dirname, 'statsdrive.js'), ROOT], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      VOIDBLOOM_STATS: '1',
      VOIDBLOOM_STATS_URL: 'http://127.0.0.1:' + port,
      VOIDBLOOM_STATS_KEY: KEY
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let out = '';
  child.stdout.on('data', d => { out += d; });
  const kill = setTimeout(() => child.kill('SIGKILL'), 180000);

  child.on('exit', () => {
    clearTimeout(kill);
    server.close();
    const line = k => (out.split('\n').find(l => l.startsWith('DRIVE ' + k)) || '').slice(7 + k.length);

    const hooked = JSON.parse(line('hooked') || '{}');
    if (!hooked.on || !hooked.bridge || !hooked.wrapped) problems.push('tracker not hooked: ' + JSON.stringify(hooked));
    const errs = JSON.parse(line('errors') || '["no report"]');
    if (errs.length) problems.push('console errors: ' + errs.join(' | '));

    for (const g of got) {
      if (g.apikey !== KEY) { problems.push('wrong apikey on ' + g.url); break; }
      if (g.auth) { problems.push('publishable key must not go in Authorization'); break; }
    }

    const runs = got.filter(g => g.url === '/rest/v1/rpc/vb_run').map(g => g.p);
    const want = [
      ['skirmish', 'medium', null, 'dead', false],
      ['skirmish', 'easy', null, 'quit', false],
      ['conquest', 'hard', 'VERDANCE', 'win', false],
      ['conquest', 'hard', 'VERDANCE', 'dead', true],
      ['endless', 'endless', null, 'quit', false]
    ];
    const seen = runs.map(r => [r.mode, r.difficulty, r.planet || null, r.outcome, !!r.act2]);
    if (JSON.stringify(seen) !== JSON.stringify(want)) {
      problems.push('runs were\n    ' + seen.map(x => JSON.stringify(x)).join('\n    ') +
                    '\n  expected\n    ' + want.map(x => JSON.stringify(x)).join('\n    '));
    }
    if (new Set(runs.map(r => r.run_id)).size !== runs.length) problems.push('a run was sent twice');
    for (const r of runs) {
      if (!r.install_id || !r.session_id || !r.run_id) { problems.push('run missing ids'); break; }
      if (!Array.isArray(r.weapons) || r.weapons[0] !== 'pulse') { problems.push('run weapons wrong: ' + JSON.stringify(r.weapons)); break; }
    }

    const beats = got.filter(g => g.url === '/rest/v1/rpc/vb_beat').map(g => g.p);
    const last = beats[beats.length - 1] || {};
    if (beats.length < 2) problems.push('expected a heartbeat and a final beat, got ' + beats.length);
    if (!last.ended) problems.push('final beat not marked ended');
    if (!(last.play_s > 5)) problems.push('play time not counted: ' + last.play_s);
    if (!(last.app_s >= last.play_s)) problems.push('app time < play time');
    if (!last.save || typeof last.save.runs !== 'number') problems.push('no save summary in the final beat');
    if (!last.dev) problems.push('a dev checkout must flag its rows dev');

    console.log('runs:  ' + seen.map(x => x[0] + '/' + x[3] + (x[4] ? '(act II)' : '')).join(', '));
    console.log('beats: ' + beats.length + ', last ' + JSON.stringify({ app_s: last.app_s, active_s: last.active_s, play_s: last.play_s, ended: last.ended }));
    console.log('close: ' + line('will-quit'));
    if (problems.length) console.log('\nPROBLEMS:\n  ' + problems.join('\n  ') + '\n\n=== FAIL');
    else console.log('\n=== PASS');
    try { fs.rmSync(ud, { recursive: true, force: true }); } catch (e) { }
    process.exit(problems.length ? 1 : 0);
  });
});
