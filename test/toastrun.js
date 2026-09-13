const { spawn } = require('node:child_process');
const path = require('node:path');
const electron = require('electron');
const ROOT = require('node:path').join(__dirname,'..');
const c = spawn(electron, ['--no-sandbox','--enable-unsafe-swiftshader','-r',path.join(ROOT,'test','toastmain.js'),ROOT],
  { cwd: ROOT, env: { ...process.env, VOIDBLOOM_TOAST: '1' }, stdio:['ignore','pipe','pipe'] });
c.stdout.on('data', d => process.stdout.write(d));
c.stderr.on('data', d => { const s=String(d); if(!/bus\.cc|GPU|Vulkan|dbus|libva|gbm|Fontconfig|MESA|GL_|EGL|sandbox|ssl_client|Security Warning|electronjs\.org/i.test(s)) process.stderr.write(s); });
setTimeout(()=>c.kill('SIGKILL'), 140000);
