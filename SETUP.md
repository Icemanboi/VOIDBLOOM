# VOIDBLOOM Desktop — setup

Repo: **github.com/Icemanboi/VOIDBLOOM**

Your username is already filled into `package.json`, so there's nothing to
edit. Four commands and you have an installer.

You do **not** need Node, Electron, or any build tools on your ThinkPad.
GitHub builds the installer on its own Windows machines.

---

## Before you start

**Git installed** — open PowerShell and type `git --version`. If it errors,
get it from [git-scm.com](https://git-scm.com/download/win) and click Next
through the installer; the defaults are fine.

**One note about OneDrive.** This folder is inside OneDrive, which is fine for
everything below. But if you ever run `npm install` here, move the folder out
first (`C:\Users\mrisa\voidbloom-desktop` is a good spot) — `npm install`
drops about 30,000 small files into `node_modules` and OneDrive will try to
sync every one of them. Nothing breaks, it just crawls.

---

## Step 1 — Put the build script where GitHub looks for it

The build instructions are sitting in this folder as `release-workflow.yml`.
GitHub only runs it from `.github\workflows\`, and I couldn't create that
folder on your machine directly — writing into it is blocked by design,
because anything in there runs code.

Open PowerShell **inside the `desktop` folder** (Shift + right-click in the
folder → *Open PowerShell window here*) and paste this:

```powershell
New-Item -ItemType Directory -Force -Path .github\workflows | Out-Null
Move-Item release-workflow.yml .github\workflows\release.yml
```

`.github` won't show in Explorer unless hidden files are on — that's normal on
Windows for folders starting with a dot. It's there.

---

## Step 2 — Push it

Same PowerShell window:

```powershell
git init
git add .
git commit -m "VOIDBLOOM desktop app"
git branch -M main
git remote add origin https://github.com/Icemanboi/VOIDBLOOM.git
git push -u origin main
```

The first push opens a browser to sign in to GitHub. Approve it.

Refresh github.com/Icemanboi/VOIDBLOOM — the files are there.

---

## Step 3 — Build the first release

```powershell
git tag v1.0.0
git push origin v1.0.0
```

Pushing a **tag** is what starts a build. Ordinary commits don't.

Go to your repo → **Actions** tab. A job is running; it takes three to five
minutes. When the tick goes green, click **Releases** in the right sidebar of
the repo home page.

There's `VOIDBLOOM-Setup-1.0.0.exe`. That's the file you give people.

---

## Step 4 — Install it

Download the `.exe` from your own Releases page and run it.

Windows SmartScreen will say **"Windows protected your PC"**. That's not a
problem with the file — the installer isn't code-signed, and a certificate
costs a few hundred dollars a year. Click **More info** → **Run anyway**.

Everyone who downloads it sees this until you buy a certificate, so tell
people up front or they'll think it's a virus.

---

# Shipping an update

## Double-click `UPDATE GAME.bat`

That's the whole thing. It sits in the `desktop` folder and does every step
for you:

1. Copies the newest `VOIDBLOOM.html` from the folder above into `game\`
2. Runs the same checks the build runs — right size, has a `boot()` call, and
   isn't `TEST_BUILD.html` with the debug hook in it
3. Shows the current version and suggests the next one. Press **Enter** to
   accept `1.0.1`, or type your own
4. Asks what changed, in a few words
5. Shows you exactly what it's about to do and waits for one more Enter
6. Commits, tags, pushes — and offers to open the Actions page

If anything is wrong it stops and tells you what, in plain words, before
touching a single file. Close the window at the confirm step and nothing has
happened.

Three to five minutes later there's a new release, and anyone with the app
installed sees a small bar at the bottom of the game window next time they
open it:

> ● VERSION 1.0.1 READY   **RESTART**   ✕

It's deliberately not a pop-up dialog — an update can land four minutes into
a boss fight, and a window stealing focus right then would be miserable. They
click RESTART when they feel like it, or dismiss it and it installs quietly
when they next close the game. Saves are kept either way.

---

### Doing it by hand

If you'd rather, or if the script chokes on something:

```powershell
git add .
git commit -m "Pets redrawn, DAY ZERO skin"
git push
git tag v1.0.1
git push origin v1.0.1
```

Bump `"version"` in `package.json` first, and make the tag match — `v1.0.1`
for `1.0.1`. It must go **up**: `1.0.1` for fixes, `1.1.0` for new content,
`2.0.0` for something huge. Auto-update won't install anything that isn't
higher than what's already there. The build checks the tag against the
version and stops with a clear error if they disagree.

---

## Things that will save you a headache

**Saves survive updates, by design.** The app serves the game from its own
`voidbloom://app` address rather than as a loose file. That gives it a fixed
identity that never changes between versions, so localStorage — every save,
skin, achievement and redeemed code — carries over. If you ever rewrite
`main.js`, don't change that scheme or you wipe everyone's progress.

**Desktop saves are separate from browser saves.** Someone who's played on
itch.io starts fresh in the app. Different storage, unavoidable — but worth
saying on your download page.

**The app makes zero network requests.** The CrazyGames SDK can't load (its
hostname check fails against `voidbloom://app`), and Chromium's own
background chatter is switched off in `main.js`. The only thing it contacts
is GitHub, asking whether there's a newer release.

**Don't delete a release once people have it.** Auto-update reads a file
called `latest.yml` from your newest release. Deleting releases, or editing
their files by hand, can leave installed apps unable to find updates.

**Your `CODES` folder must stay out of this repo.** It's public — anyone can
read every file in it. The answer key stays on your machine. (It's one level
up from `desktop`, so `git add .` won't catch it. Just don't move it in.)

**If Actions fails**, click the red X → the failed step. Usually a tag that
doesn't match the version. To redo a tag you've already pushed:

```powershell
git tag -d v1.0.1
git push origin :refs/tags/v1.0.1
git tag v1.0.1
git push origin v1.0.1
```

---

## Running it locally

Optional. In the `desktop` folder:

```powershell
npm install
npm start
```

Opens the app straight from the folder. Auto-update is deliberately off in
this mode — there's no installed copy to replace.

`npm run dist` builds an installer locally into `desktop\dist\` without
publishing anything.
