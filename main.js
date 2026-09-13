'use strict';

const { app, BrowserWindow, Menu, protocol, net, dialog, shell } = require('electron');
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
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false  // keep running at full rate when unfocused
    }
  });

  // It's a game, not an editor: no File/Edit/View menu.
  Menu.setApplicationMenu(null);

  win.once('ready-to-show', () => { win.show(); });

  win.webContents.on('did-finish-load', () => {
    // ctrl+scroll and pinch would scale the canvas and wreck the layout
    win.webContents.setVisualZoomLevelLimits(1, 1);
  });

  // F11 fullscreen; everything else belongs to the game.
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
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

app.on('window-all-closed', () => { app.quit(); });

/* ------------------------------------------------------------------ *
 *  Updates
 *
 *  electron-updater reads the latest.yml that electron-builder publishes
 *  alongside the installer on GitHub Releases, and only acts when the
 *  release version is higher than this build's. It downloads in the
 *  background and installs on restart, so it never interrupts a run.
 * ------------------------------------------------------------------ */
function setupUpdates() {
  // In a dev checkout there is no installer to replace, so don't try.
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-downloaded', async (info) => {
    if (!win) return;
    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'VOIDBLOOM',
      message: 'Version ' + info.version + ' is ready.',
      detail: 'Your saves, skins and codes are kept. It will also install by itself next time you close the game.'
    });
    if (response === 0) {
      setImmediate(() => autoUpdater.quitAndInstall());
    }
  });

  // No internet, a private repo, no releases yet — all normal. Never
  // pop a dialog at the player for any of it.
  autoUpdater.on('error', (err) => {
    console.log('[update] ' + (err && err.message ? err.message : err));
  });

  // Let the game finish booting before competing for bandwidth.
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 8000);
}

}
