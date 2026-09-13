'use strict';
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

if (!process.env.VOIDBLOOM_SHOT) return;

const OUT = '/home/claude/vb/shots';
const wait = ms => new Promise(r => setTimeout(r, ms));

app.on('browser-window-created', (_e, win) => {
  const wc = win.webContents;
  wc.once('did-finish-load', async () => {
    try {
      // let it boot and settle
      await wc.executeJavaScript(`
        new Promise(res => { const t0=Date.now();
          const t=()=>{ if((window.VOIDBLOOM&&window.VOIDBLOOM.Game)||Date.now()-t0>45000) res(1); else setTimeout(t,250); };
          t(); })
      `);
      await wait(4000);

      const grab = async (name) => {
        const img = await wc.capturePage();
        fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG());
        console.log('shot: ' + name);
      };

      await grab('app1_title');

      // drop into a run so the arena, HUD and all four layers are on screen
      await wc.executeJavaScript(`
        (function(){ const V=window.VOIDBLOOM; V.Game.reset('medium','verdance'); V.Game.time=4; return 1; })()
      `);
      await wait(4000);
      await grab('app2_run');

      // and the galaxy map, which is the heaviest cosmos shader
      await wc.executeJavaScript(`
        (function(){ const V=window.VOIDBLOOM; V.Game.state='conquest'; V.UI.lastState=''; return 1; })()
      `);
      await wait(4000);
      await grab('app3_map');

      app.exit(0);
    } catch (e) {
      console.log('shot failed: ' + e.message);
      app.exit(1);
    }
  });
});
