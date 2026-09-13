# VOIDBLOOM — Desktop

`github.com/Icemanboi/VOIDBLOOM`

A bullet-heaven in a garden at the bottom of the dark, wrapped as a Windows app.

**[Download the latest release →](../../releases/latest)**

Windows will warn you the first time ("Windows protected your PC") because the
installer isn't code-signed. Click *More info* → *Run anyway*.

---

## For me, later

**Ship an update:** copy the new `VOIDBLOOM.html` into `game/`, bump
`version` in `package.json`, then:

```powershell
git add . && git commit -m "what changed" && git push
git tag v1.0.1 && git push origin v1.0.1
```

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
| `test/` | The smoke test |

**The one thing not to break:** the game is served over `voidbloom://app`
rather than loaded as a file. That gives it a fixed origin, which is what
makes localStorage — every save, skin, achievement and redeemed code —
survive an update. Change the scheme and you wipe everyone's progress.
