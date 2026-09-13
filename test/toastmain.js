/* Forces the update toast on screen so it can be looked at, and checks that
   it sits above every game layer and doesn't steal clicks from the canvas. */
'use strict';
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

if (!process.env.VOIDBLOOM_TOAST) return;

const OUT = '/home/claude/vb/shots';
const wait = ms => new Promise(r => setTimeout(r, ms));

const MEASURE = `
  (function(){
    var el = document.getElementById('vb-update');
    if (!el) return { present:false };
    var r = el.getBoundingClientRect();
    var cs = getComputedStyle(el);
    var cx = r.left + r.width/2, cy = r.top + r.height/2;
    var mid = document.elementFromPoint(cx, cy);
    // walk up from the toast and report anything that could be hiding it
    var chain = [], n = el;
    while (n && n !== document.documentElement) {
      var s = getComputedStyle(n);
      chain.push((n.id||n.tagName) + ':z' + s.zIndex + ':op' + s.opacity +
                 (s.mixBlendMode !== 'normal' ? ':blend-' + s.mixBlendMode : '') +
                 (s.filter !== 'none' ? ':filter' : '') +
                 (s.transform !== 'none' ? ':tf' : ''));
      n = n.parentElement;
    }
    // what is painted at that point among the game's own layers
    var layers = ['cosmos','game','fx','grille','boot'].map(function(id){
      var e = document.getElementById(id);
      if (!e) return id + ':absent';
      var s = getComputedStyle(e);
      return id + ':' + s.display + ':z' + s.zIndex + ':op' + s.opacity +
             (s.mixBlendMode !== 'normal' ? ':' + s.mixBlendMode : '');
    });
    return {
      present:true, visible: cs.visibility, opacity: cs.opacity, display: cs.display,
      rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      bottomGap: Math.round(innerHeight - r.bottom),
      zIndex: cs.zIndex,
      hitAtCentre: mid ? (mid.id || mid.className || mid.tagName) : null,
      inBody: el.parentElement === document.body,
      chain: chain,
      layers: layers,
      bridge: typeof window.vbUpdate === 'object' && typeof window.vbUpdate.restart === 'function',
      label: el.querySelector('b') ? el.querySelector('b').textContent : null
    };
  })()
`;

app.on('browser-window-created', (_e, win) => {
  const wc = win.webContents;
  wc.once('did-finish-load', async () => {
    try {
      await wc.executeJavaScript(`
        new Promise(res => { const t0=Date.now();
          const t=()=>{ if((window.VOIDBLOOM&&window.VOIDBLOOM.Game)||Date.now()-t0>45000) res(1); else setTimeout(t,250); };
          t(); })
      `);
      await wait(3000);

      // ---- on the title screen
      global.__showToast(win, '1.0.1');
      await wait(4000);
      console.log('TITLE  ' + JSON.stringify(await wc.executeJavaScript(MEASURE)));
      fs.writeFileSync(path.join(OUT, 'app4_toast_title.png'), (await wc.capturePage()).toPNG());
      console.log('shot: app4_toast_title');
      // the software compositor here runs at ~2fps; give it a long gap and
      // capture the SAME screen again to tell a paint bug from a stale frame
      await wait(10000);
      fs.writeFileSync(path.join(OUT, 'app4b_toast_title_late.png'), (await wc.capturePage()).toPNG());
      console.log('shot: app4b_toast_title_late');

      // ---- and during a run, where it will really appear
      await wc.executeJavaScript(`
        (function(){ const V=window.VOIDBLOOM; V.Game.reset('medium','cinderholt'); V.Game.time=6; return 1; })()
      `);
      await wait(3500);
      console.log('RUN    ' + JSON.stringify(await wc.executeJavaScript(MEASURE)));
      fs.writeFileSync(path.join(OUT, 'app5_toast_run.png'), (await wc.capturePage()).toPNG());
      console.log('shot: app5_toast_run');

      await wc.executeJavaScript(`document.querySelector('#vb-update .x').click(); true`);
      await wait(900);
      console.log('dismiss removes it: ' + await wc.executeJavaScript(`!document.getElementById('vb-update')`));

      global.__showToast(win, '1.0.2');
      await wait(600);
      console.log('can show again: ' + await wc.executeJavaScript(`!!document.getElementById('vb-update')`));

      app.exit(0);
    } catch (e) {
      console.log('toast test failed: ' + e.message);
      app.exit(1);
    }
  });
});
