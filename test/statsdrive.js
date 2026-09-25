/* Loaded with -r by test/statsrun.js: plays a scripted session through the
   real game functions, then closes the window the way a player would. */

'use strict';
const { app, BrowserWindow } = require('electron');
const SCRIPT = 'full';
const errors = [];
const NOISE = /Electron Security Warning|electronjs\.org\/docs|GL Driver Message|GPU stall|CONTEXT_LOST_WEBGL|SwiftShader|Automatic fallback|will not show up|Policy set|unnecessary|For more information/i;
const sleep = ms => new Promise(r => setTimeout(r, ms));
app.on('browser-window-created', (_e, win) => {
  const wc = win.webContents;
  wc.on('console-message', (_ev, level, msg) => { if (level >= 2 && !NOISE.test(msg)) errors.push(msg); });
  wc.once('did-finish-load', async () => {
    const js = s => wc.executeJavaScript(s);
    try {
      await js(`new Promise(r => { const t = () => (window.VOIDBLOOM && window.VOIDBLOOM.Game) ? r() : setTimeout(t, 200); t(); })`);
      await sleep(1500);
      const hooked = await js(`({ on: !!window.__vbStatsOn, bridge: !!window.vbStats, wrapped: !!(VOIDBLOOM.Game.reset.__vbStats && VOIDBLOOM.Game.gameOver.__vbStats && VOIDBLOOM.Game.pressOn.__vbStats) })`);
      console.log('DRIVE hooked ' + JSON.stringify(hooked));
      if (SCRIPT === 'full') {
        // 1. a medium skirmish run that dies
        await js(`VOIDBLOOM.Game.reset('medium'); true`); await sleep(4000);
        await js(`VOIDBLOOM.Game.gameOver(false); true`); await sleep(1500);
        // 2. an easy run abandoned from the pause menu (ABANDON RUN sets state 'title')
        await js(`VOIDBLOOM.Game.reset('easy'); true`); await sleep(2500);
        await js(`VOIDBLOOM.Game.state = 'paused'; true`); await sleep(1200);
        await js(`VOIDBLOOM.Game.state = 'settings'; true`); await sleep(1200);   // settings from pause must NOT end the run
        await js(`VOIDBLOOM.Game.state = 'paused'; true`); await sleep(1200);
        await js(`VOIDBLOOM.Game.state = 'title'; true`); await sleep(1500);
        // 3. a conquest planet won, then PRESS ON, then died in act II
        await js(`VOIDBLOOM.Game.reset('hard', 'verdance'); true`); await sleep(2500);
        await js(`VOIDBLOOM.Game.gameOver(true); true`); await sleep(1500);
        await js(`VOIDBLOOM.Game.pressOn(); true`); await sleep(2500);
        await js(`VOIDBLOOM.Game.gameOver(false); true`); await sleep(1000);
        await js(`VOIDBLOOM.Game.state = 'title'; true`); await sleep(800);
        // 4. an endless run still going when the window closes
        await js(`VOIDBLOOM.Game.reset('endless'); true`);
        await sleep(Math.max(0, 22000 - (Date.now() - global.__t0)));   // past the first heartbeat
      }
      console.log('DRIVE errors ' + JSON.stringify(errors));
      console.log('DRIVE closing at ' + ((Date.now() - global.__t0) / 1000).toFixed(1) + 's');
      global.__closeT = Date.now();
      win.close();
    } catch (e) { console.log('DRIVE threw ' + e.message); app.exit(3); }
  });
});
global.__t0 = Date.now();
app.on('will-quit', () => { console.log('DRIVE will-quit after ' + (Date.now() - (global.__closeT || Date.now())) + 'ms'); });
