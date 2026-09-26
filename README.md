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

### Online extras (desktop app only)

- **Cloud save.** SETTINGS → CLOUD SAVE → CREATE MY SAVE CODE gives you a code
  like `VB-7K2M-QX9P-4TRA`. Write it down. From then on your save backs itself
  up after every run and when you quit. New PC, or reinstalled? CLOUD SAVE →
  RESTORE FROM A CODE brings everything back. No account, no email.
- **Leaderboards.** Skirmish at every difficulty (this week and all time),
  Endless, and today's Daily Challenge. Pick a name to show up on them, or
  don't — you'll still see where you'd rank.
- **News and events** on the title screen, like double-shard weekends.

### Play stats

The desktop app sends anonymous play statistics and error reports — how long
you play, how your runs end, which planets and weapons, your OS and graphics
card, and what went wrong if the game hits an error — to help balance the game
and fix bugs. Each install gets a random ID; no callsigns or personal details
are sent. Your cloud save and leaderboard name are stored only if you choose to
use them. To switch off stats and error reports, set the environment variable
`VOIDBLOOM_NO_STATS=1` (your runs then don't reach the leaderboards). The
browser version sends nothing.

---

