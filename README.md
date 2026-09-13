# VOIDBLOOM — Desktop

`github.com/Icemanboi/VOIDBLOOM`

A bullet-heaven in a garden at the bottom of the dark, wrapped as a Windows and
macOS app.

**[Download the latest release →](../../releases/latest)**

| You're on | Take |
|---|---|
| Windows | `VOIDBLOOM-Setup-x.y.z.exe` |
| Mac, Apple silicon (M1–M4) | `VOIDBLOOM-x.y.z-arm64.dmg` |
| Mac, Intel | `VOIDBLOOM-x.y.z-x64.dmg` |

Not sure which Mac? Apple menu → About This Mac. "Apple M1/M2/M3/M4" means
arm64; "Intel" means x64.

### Windows warns on first run

"Windows protected your PC" — the installer isn't code-signed. Click
*More info* → *Run anyway*.

### macOS blocks it on first run

You'll see **"VOIDBLOOM is damaged and can't be opened"**, or *"cannot be
opened because the developer cannot be verified"*. The app is fine. macOS says
that about every app that hasn't been through Apple's paid signing programme,
whether it's broken or not.

Open the DMG, drag VOIDBLOOM to Applications, then run this once in Terminal:

```
xattr -dr com.apple.quarantine /Applications/VOIDBLOOM.app
```

Then open it normally. You only ever do this once, and not again for updates.

*(Right-click → Open used to be enough and still works on some versions of
macOS. If it does, you can skip the Terminal line.)*

**Don't want to touch Terminal?** [Play it in the browser instead](https://icemanboi.itch.io/voidbloom)
— same game, nothing to install, works on any Mac.

---

## For me, later

**Ship an update:** double-click `UPDATE GAME.bat`. It copies the newest
`VOIDBLOOM.html` in, checks it, bumps the version, commits, tags and pushes.
GitHub builds **both** Windows and macOS and publishes them to the same
release. Full walkthrough in [SETUP.md](SETUP.md).

**Run it locally:** `npm install` then `npm start`.

**Test it properly:** `npm test` — boots the real app and checks the game
reaches its title screen, that localStorage survives a reload, and that
nothing leaves the machine.

---

## How it fits together

| File | What it does |
|---|---|
| `main.js` | The app: window, custom `voidbloom://` scheme, auto-update |
| `game/VOIDBLOOM.html` | The whole game. One file, no assets. |
| `build/icon.ico` | Windows icon, with separate drawings for the small sizes |
| `build/icon.png` | 1024px master; electron-builder makes the mac `.icns` from it |
| `build/entitlements.mac.plist` | JIT permissions Electron needs under the hardened runtime |
| `make_icon.py` | Regenerates the icon |
| `.github/workflows/release.yml` | Builds Windows + macOS and publishes on a `v*` tag |
| `UPDATE GAME.bat` | Double-click to ship an update |
| `tools/update.ps1` | What that actually runs |
| `preload.js` | The two-function bridge for the update bar |
| `test/` | The smoke test |

**The one thing not to break:** the game is served over `voidbloom://app`
rather than loaded as a file. That gives it a fixed origin, which is what
makes localStorage — every save, skin, achievement and redeemed code —
survive an update. Change the scheme and you wipe everyone's progress.

---

## The macOS build, and what it costs

Nothing. GitHub's macOS runners are free on public repositories, and
electron-builder is free. The mac job builds four files — a `.dmg` and a
`.zip`, each for Apple silicon and Intel — and puts them on the same release
as the Windows installer.

Two things are different on mac, both because the app is unsigned:

1. **Players clear the quarantine flag once** (the Terminal line above). This
   is the only cost of not paying Apple.
2. **Auto-update doesn't run on mac.** Apple's updater verifies a signature
   before it will swap an app bundle, and there isn't one. The check fails,
   gets logged, and the player never sees anything — Windows auto-update is
   unaffected. Mac players update by downloading the new DMG.

### If you ever do get an Apple Developer account

$99/yr, and then both of those go away. **No code changes needed** — the
workflow already handles it. Add these five repository secrets and the next
tag builds signed and notarized instead:

| Secret | What it is |
|---|---|
| `MAC_CERT_P12` | Your Developer ID Application certificate, base64-encoded |
| `MAC_CERT_PASSWORD` | The password you set when exporting that .p12 |
| `APPLE_ID` | Your Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | From appleid.apple.com → App-Specific Passwords |
| `APPLE_TEAM_ID` | The 10-character team ID from your developer account |

The job checks for `MAC_CERT_P12` and `APPLE_TEAM_ID`; with both present it
signs and notarizes, with either missing it builds unsigned. Nothing to
remember, nothing to switch on.
