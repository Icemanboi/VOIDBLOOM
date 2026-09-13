'use strict';

const { app, BrowserWindow, Menu, protocol, net, shell, ipcMain } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { autoUpdater } = require('electron-updater');

const GAME_DIR = path.join(__dirname, 'game');
const START = 'voidbloom://app/VOIDBLOOM.html';

/* ------------------------------------------------------------------ *
 *  Why a custom scheme instead of just loading the file
 *
 *  The game keeps every save, unlock, skin and redeemed code in
 *  localStorage. localStorage is partitioned by ORIGIN, and a file://
 *  page has no real origin — which means saves can be dropped or
 *  siloed, and in some packaging layouts the path changes between
 *  versions, so an update would silently wipe the player's progress.
 *
 *  Registering our own scheme as `standard` + `secure` gives the page a
 *  fixed, real origin (voidbloom://app) that never changes across
 *  versions. Saves survive updates. This is the whole reason for the
 *  twenty lines below.
 * ------------------------------------------------------------------ */
protocol.registerSchemesAsPrivileged([{
  scheme: 'voidbloom',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
}]);

/* The game itself never touches the network — the CrazyGames SDK is behind a
   hostname check that our own scheme can't satisfy. But Chromium phones home
   on its own for component updates, which on a plane or a school network is
   just a stalled socket and a log full of TLS errors. Turn it off; the only
   traffic this app should ever make is the update check below. */
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-background-networking');

// Two copies of the game running at once would fight over the same save.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {

app.setAppUserModelId('com.isaacleung.voidbloom');

let win = null;

app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 760,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: '#05070f',   // no white flash before the game paints
    show: false,
    autoHideMenuBar: true,
    title: 'VOIDBLOOM',
    // Windows and Linux take the icon from the window; macOS takes it from
    // the .app bundle that electron-builder assembles, and passing a .ico
    // here would just be ignored.
    ...(process.platform === 'darwin'
      ? {}
      : { icon: path.join(__dirname, 'build', 'icon.ico') }),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false  // keep running at full rate when unfocused
    }
  });

  // It's a game, not an editor: no File/Edit/View menu.
  //
  // macOS is the exception. There the menu bar belongs to the OS, not the
  // window: with no menu at all the player loses Cmd+Q, Cmd+W, Cmd+M and
  // Hide, and the only way out of the app is Force Quit. So on mac we put
  // back the smallest menu that restores those, and nothing else.
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' }
        ]
      },
      {
        label: 'Window',
        submenu: [
          { role: 'minimize' },
          { role: 'close' },
          { type: 'separator' },
          { role: 'togglefullscreen' }
        ]
      }
    ]));
  } else {
    Menu.setApplicationMenu(null);
  }

  win.once('ready-to-show', () => { win.show(); });

  win.webContents.on('did-finish-load', () => {
    // ctrl+scroll and pinch would scale the canvas and wreck the layout
    win.webContents.setVisualZoomLevelLimits(1, 1);
  });

  // F11 fullscreen (Ctrl+Cmd+F as well on mac, which is where mac players
  // will reach for it); everything else belongs to the game.
  win.webContents.on('before-input-event', (e, input) => {
    const macFull = process.platform === 'darwin' &&
      input.control && input.meta && (input.key === 'f' || input.key === 'F');
    if (input.type === 'keyDown' && (input.key === 'F11' || macFull)) {
      e.preventDefault();
      win.setFullScreen(!win.isFullScreen());
    }
  });

  // Nothing in the game should ever navigate or open a window. If a link
  // ever does appear, send it to the real browser instead of replacing
  // the game with a web page the player can't get back from.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('voidbloom://')) {
      e.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  win.on('closed', () => { win = null; });

  win.loadURL(START);
}

app.whenReady().then(() => {
  // Serve the game folder over our scheme, refusing anything outside it.
  protocol.handle('voidbloom', async (request) => {
    const { host, pathname } = new URL(request.url);
    if (host !== 'app') return new Response('not found', { status: 404 });

    const rel = decodeURIComponent(pathname).replace(/^\/+/, '');
    const file = path.join(GAME_DIR, rel);

    // path traversal guard: the resolved file must stay inside game/
    const inside = path.relative(GAME_DIR, file);
    if (inside.startsWith('..') || path.isAbsolute(inside)) {
      return new Response('forbidden', { status: 403 });
    }

    const res = await net.fetch(pathToFileURL(file).toString());

    /* The game is one self-contained file: no workers, no blobs, no fetch,
       no remote anything. So lock the page down to exactly that. 'unsafe-
       inline' is unavoidable — the whole game IS an inline <script> — but
       with no remote script source and connect-src 'none' there is nothing
       to load and nowhere to send anything. It also means that if the
       CrazyGames SDK's hostname check is ever loosened by accident, the
       browser still refuses to fetch it. */
    const headers = new Headers(res.headers);
    headers.set('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "media-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'none'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'"
    ].join('; '));

    return new Response(res.body, { status: res.status, headers });
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  setupUpdates();
});

// On macOS closing the window is not quitting: the app stays in the Dock and
// the green button / Cmd+W are expected to leave it running. Everywhere else,
// the last window closing means the player is done.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* ------------------------------------------------------------------ *
 *  Updates
 *
 *  electron-updater reads the latest.yml that electron-builder publishes
 *  alongside the installer on GitHub Releases, and only acts when the
 *  release version is higher than this build's. It downloads in the
 *  background and installs on restart, so it never interrupts a run.
 * ------------------------------------------------------------------ */
function setupUpdates() {
  ipcMain.on('vb-update-restart', () => {
    setImmediate(() => autoUpdater.quitAndInstall());
  });
  ipcMain.on('vb-update-dismiss', () => { /* installs on quit anyway */ });

  // In a dev checkout there is no installer to replace, so don't try.
  if (!app.isPackaged) return;

  // macOS will only apply an update to a validly signed app -- Apple's
  // updater verifies the signature before swapping the bundle. While the mac
  // build is unsigned the check below fails, gets logged, and the player
  // never sees anything. Nothing here needs changing on the day it is signed:
  // it starts working on its own.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-downloaded', (info) => {
    if (win) showUpdateToast(win, info.version);
  });

  // No internet, no releases yet, GitHub having a bad day — all normal.
  // Never put any of it in front of the player.
  autoUpdater.on('error', (err) => {
    console.log('[update] ' + (err && err.message ? err.message : err));
  });

  // Let the game finish booting before competing for bandwidth.
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 8000);
}

/* ------------------------------------------------------------------ *
 *  The update notice
 *
 *  Deliberately NOT a modal dialog. An update lands whenever it lands,
 *  and a system dialog stealing focus four minutes into a boss fight is
 *  the worst possible moment for it. Instead: a small bar at the bottom
 *  of the window that waits as long as it needs to, and installs on quit
 *  regardless of whether the player ever touches it.
 *
 *  Injected from here rather than built into the game, so VOIDBLOOM.html
 *  stays the same file that ships to CrazyGames and itch.
 * ------------------------------------------------------------------ */
function showUpdateToast(w, version) {
  const js = `(function (v) {
    if (document.getElementById('vb-update')) return;

    var css = document.createElement('style');
    css.textContent = [
      /* No entrance animation, on purpose -- see the note in the JS below.
         The only thing that moves is the dot, which can stall harmlessly. */
      '#vb-update{position:fixed;left:50%;bottom:14px;transform:translate(-50%,0);opacity:1;',
      'z-index:2147483647;display:flex;align-items:center;gap:11px;',
      'padding:8px 10px 8px 13px;border-radius:10px;',
      'background:linear-gradient(180deg,rgba(14,17,38,.93),rgba(7,9,22,.96));',
      'border:1px solid rgba(158,247,255,.34);',
      'box-shadow:0 0 22px rgba(158,247,255,.16),0 8px 26px -10px #000,inset 0 1px 0 rgba(255,255,255,.05);',
      'font:700 11px/1 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.14em;',
      'color:#dfe7ff;',
      'pointer-events:auto;user-select:none;-webkit-user-select:none}',
      '#vb-update .dot{width:7px;height:7px;border-radius:50%;background:#8dff6b;',
      'box-shadow:0 0 8px #8dff6b;animation:vbp 1.9s ease-in-out infinite;flex:none}',
      '@keyframes vbp{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.72)}}',
      '#vb-update b{color:#9ef7ff;font-weight:900;letter-spacing:.16em}',
      '#vb-update .go{cursor:pointer;padding:6px 12px;border-radius:7px;',
      'background:linear-gradient(180deg,#2a2352,#171037);color:#ffd166;',
      'border:1px solid rgba(255,209,102,.42);letter-spacing:.16em;font-weight:900}',
      '#vb-update .go:hover{background:linear-gradient(180deg,#3a2e6d,#22174a);color:#fff}',
      '#vb-update .x{cursor:pointer;padding:5px 8px;color:#7d86ab;font-size:13px;line-height:1}',
      '#vb-update .x:hover{color:#dfe7ff}'
    ].join('');
    document.head.appendChild(css);

    var el = document.createElement('div');
    el.id = 'vb-update';
    el.innerHTML =
      '<span class="dot"></span>' +
      '<span>VERSION <b></b> READY</span>' +
      '<span class="go">RESTART</span>' +
      '<span class="x" title="Later">&#10005;</span>';
    el.querySelector('b').textContent = v;
    document.body.appendChild(el);

    /* It appears instantly, with no entrance animation. That is a
       deliberate trade, not an oversight.

       The game owns the frame loop and can starve it -- a heavy shader, a
       weak GPU, three hundred bullets on screen. Anything frame-driven
       (rAF, a CSS transition, a keyframe animation) then holds at its
       starting value, and a bar that starts at opacity 0 stays invisible:
       the player is never told there is an update at all. Measured here on
       a software renderer: nine frames in four seconds, and even a 700ms
       setTimeout fired 1750ms late. Those are the exact conditions -- a
       struggling machine mid-fight -- where the notice matters most.

       So the toast simply exists, already visible. The only moving part is
       the dot, which can stall without hiding anything. */

    var close = function () {
      el.style.transition = 'opacity .3s ease, transform .3s ease';
      el.style.opacity = '0';
      el.style.transform = 'translate(-50%,26px)';
      // removal is on a timer, not on transitionend, for the same reason
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 350);
    };
    el.querySelector('.go').addEventListener('click', function () {
      try { window.vbUpdate.restart(); } catch (e) {}
    });
    el.querySelector('.x').addEventListener('click', function () {
      close();
      try { window.vbUpdate.dismiss(); } catch (e) {}
    });

    // Keep the game's keyboard handling untouched: swallow nothing, and
    // never let a click on the bar reach the canvas underneath.
    el.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
  })(${JSON.stringify(String(version))});`;

  w.webContents.executeJavaScript(js).catch(() => {});
}

// so the toast can be exercised in a test without faking a whole release
global.__showToast = showUpdateToast;

}
