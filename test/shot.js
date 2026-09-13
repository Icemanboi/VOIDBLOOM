/* Captures what the app actually looks like, from inside the real window.
   Run: xvfb-run -a npx electron --no-sandbox --enable-unsafe-swiftshader -r test/shotmain.js . */
'use strict';
const { spawn } = require('node:child_process');
const path = require('node:path');
const electron = require('electron');

const ROOT = path.join(__dirname, '..');
const child = spawn(electron,
  ['--no-sandbox', '--enable-unsafe-swiftshader', '-r', path.join(__dirname, 'shotmain.js'), ROOT],
  { cwd: ROOT, env: { ...process.env, VOIDBLOOM_SHOT: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });

child.stdout.on('data', d => process.stdout.write(d));
child.stderr.on('data', d => {
  const s = String(d);
  if (!/bus\.cc|GPU|Vulkan|dbus|libva|gbm|Fontconfig|MESA|GL_|EGL|sandbox|ssl_client/i.test(s)) process.stderr.write(s);
});
setTimeout(() => child.kill('SIGKILL'), 150000);
child.on('exit', c => process.exit(c || 0));
