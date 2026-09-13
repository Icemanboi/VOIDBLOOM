# VOIDBLOOM — Desktop

`github.com/Icemanboi/VOIDBLOOM`

A bullet-heaven in a garden at the bottom of the dark, wrapped as a Windows app.

**[Download the latest release →](../../releases/latest)**

Windows will warn you the first time ("Windows protected your PC") because the
installer isn't code-signed. Click *More info* → *Run anyway*.

---

## For me, later

**Ship an update:** double-click `UPDATE GAME.bat`. It copies the newest
`VOIDBLOOM.html` in, checks it, bumps the version, commits, tags and pushes.
GitHub builds it and everyone's copy updates itself. Full walkthrough in
[SETUP.md](SETUP.md).

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
| `build/icon.ico` | App icon, with separate drawings for the small sizes |
| `make_icon.py` | Regenerates that icon |
| `.github/workflows/release.yml` | Builds and publishes when a `v*` tag is pushed |
| `UPDATE GAME.bat` | Double-click to ship an update |
| `tools/update.ps1` | What that actually runs |
| `preload.js` | The two-function bridge for the update bar |
| `test/` | The smoke test |

**The one thing not to break:** the game is served over `voidbloom://app`
rather than loaded as a file. That gives it a fixed origin, which is what
makes localStorage — every save, skin, achievement and redeemed code —
survive an update. Change the scheme and you wipe everyone's progress.
