/* Boots the real Electron app under Xvfb and checks the things that would
   actually ruin someone's day:

     1. the window opens and the game reaches its title screen
     2. localStorage works on the custom scheme  (if it doesn't, every save,
        skin and redeemed code is lost on every launch)
     3. the origin is voidbloom://app  -- fixed, so saves survive an update
     4. all four render layers come up, WebGL included
     5. nothing in the game tries to phone home
     6. no console errors

   Run: xvfb-run -a node test/smoke.js                                       */
'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const electron = require('electron');

const PROBE = path.join(__dirname, 'probe.js');
const ROOT = path.join(__dirname, '..');

const child = spawn(electron, ['--no-sandbox', '--enable-unsafe-swiftshader', '-r', PROBE, ROOT], {
  cwd: ROOT,
  env: { ...process.env, VOIDBLOOM_SMOKE: '1' },
  stdio: ['ignore', 'pipe', 'pipe']
});

let out = '';
child.stdout.on('data', d => { out += d; process.stdout.write(d); });
child.stderr.on('data', d => { const s = String(d); if (!/GPU|Vulkan|dbus|libva|gbm|Fontconfig|MESA|GL_|EGL|sandbox/i.test(s)) process.stderr.write(s); });

const kill = setTimeout(() => { child.kill('SIGKILL'); }, 120000);

child.on('exit', (code) => {
  clearTimeout(kill);
  const pass = out.includes('SMOKE: PASS');
  console.log('\n=== ' + (pass ? 'PASS' : 'FAIL') + ' (electron exit ' + code + ')');
  process.exit(pass ? 0 : 1);
});
