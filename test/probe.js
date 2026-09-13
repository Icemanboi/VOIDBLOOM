/* Loaded into the main process with -r, so it runs alongside main.js and can
   watch the real window rather than a mock of it. */
'use strict';

const { app, BrowserWindow, session } = require('electron');

if (!process.env.VOIDBLOOM_SMOKE) return;

const problems = [];
const netHits = [];

app.whenReady().then(() => {
  // anything leaving the machine is a bug in a desktop build
  session.defaultSession.webRequest.onBeforeRequest((details, cb) => {
    if (/^https?:/i.test(details.url)) netHits.push(details.url);
    cb({});
  });
});

app.on('browser-window-created', (_e, win) => {
  const wc = win.webContents;

  /* Three kinds of noise are not the app's fault and must not fail a build:
       - Electron's own dev-mode security lecture (it says so itself: it does
         not appear once packaged)
       - SwiftShader performance chatter, because CI has no GPU
       - CONTEXT_LOST_WEBGL, which is what tearing down a page for the reload
         test looks like from inside it
     Anything else is real. */
  const NOISE = /Electron Security Warning|electronjs\.org\/docs\/tutorial\/security|GL Driver Message|GPU stall|CONTEXT_LOST_WEBGL|SwiftShader|Automatic fallback to software|will not show up\s*once the app is packaged|^\s*Policy set or a policy|^\s*this app to unnecessary|^\s*For more information/i;

  wc.on('console-message', (_ev, level, message) => {
    if (level >= 2 && !NOISE.test(message)) problems.push('console: ' + message);
  });
  wc.on('render-process-gone', (_ev, d) => problems.push('renderer gone: ' + d.reason));
  wc.on('did-fail-load', (_ev, code, desc, url) => problems.push('load failed ' + code + ' ' + desc + ' ' + url));

  wc.on('did-finish-load', async () => {
    try {
      // Give the game a moment to boot, then interrogate it.
      const r = await wc.executeJavaScript(`
        new Promise((resolve) => {
          const started = Date.now();
          const tick = () => {
            const ready = !!(window.VOIDBLOOM && window.VOIDBLOOM.Game);
            if (ready || Date.now() - started > 45000) {
              const V = window.VOIDBLOOM || {};
              // localStorage is where every save lives -- prove it round-trips
              let ls = 'threw';
              try {
                localStorage.setItem('__smoke', 'a-garden-grows');
                ls = localStorage.getItem('__smoke');
                localStorage.removeItem('__smoke');
              } catch (e) { ls = 'threw: ' + e.message; }

              const layer = id => {
                const el = document.getElementById(id);
                return !!el && el.width > 0 && el.height > 0;
              };

              resolve({
                ready: ready,
                state: V.Game && V.Game.state,
                origin: location.origin,
                proto: location.protocol,
                ls: ls,
                saveKeys: (function(){ try { return Object.keys(localStorage).length; } catch(e){ return -1; } })(),
                cosmos: layer('cosmos'), game: layer('game'), fx: layer('fx'),
                webgl: (function(){
                  try {
                    const c = document.createElement('canvas');
                    return !!(c.getContext('webgl') || c.getContext('experimental-webgl'));
                  } catch (e) { return false; }
                })(),
                dpr: window.devicePixelRatio,
                size: [innerWidth, innerHeight]
              });
              return;
            }
            setTimeout(tick, 250);
          };
          tick();
        })
      `);

      console.log('\n--- app report');
      console.log('  ' + JSON.stringify(r, null, 0));

      if (!r.ready) problems.push('game never exposed window.VOIDBLOOM');
      if (r.state !== 'title' && r.state !== 'boot') problems.push('unexpected state: ' + r.state);
      if (r.origin !== 'voidbloom://app') problems.push('origin is ' + r.origin + ', saves will not survive an update');
      if (r.ls !== 'a-garden-grows') problems.push('localStorage broken: ' + r.ls);
      if (!r.game) problems.push('#game canvas has no size');
      if (!r.webgl) problems.push('no WebGL context');

      // Second pass: does a write survive a full reload the way a save must?
      await wc.executeJavaScript(`localStorage.setItem('__persist','kept'); true`);
      wc.reload();
      wc.once('did-finish-load', async () => {
        await new Promise(r2 => setTimeout(r2, 3000));
        const kept = await wc.executeJavaScript(`
          (function(){ try { const v = localStorage.getItem('__persist'); localStorage.removeItem('__persist'); return v; } catch(e){ return 'threw'; } })()
        `);
        if (kept !== 'kept') problems.push('localStorage did not survive a reload: ' + kept);
        console.log('  persisted across reload: ' + JSON.stringify(kept));

        if (netHits.length) problems.push('made ' + netHits.length + ' network request(s): ' + netHits.slice(0, 3).join(', '));
        console.log('  outbound requests: ' + netHits.length);

        if (problems.length) {
          console.log('\nPROBLEMS:\n  ' + problems.join('\n  '));
          console.log('SMOKE: FAIL');
        } else {
          console.log('SMOKE: PASS');
        }
        app.exit(problems.length ? 1 : 0);
      });
    } catch (e) {
      console.log('probe threw: ' + e.message);
      console.log('SMOKE: FAIL');
      app.exit(1);
    }
  });
});
