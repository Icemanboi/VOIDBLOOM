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

The part you'll do over and over.

1. **Copy the new game file in** — your updated `VOIDBLOOM.html` over
   `desktop\game\VOIDBLOOM.html`.

2. **Bump the version** in `package.json`:

   ```json
   "version": "1.0.1",
   ```

   It must go **up**. `1.0.1` for fixes, `1.1.0` for new content, `2.0.0` for
   something huge. Auto-update compares these; it won't install anything that
   isn't higher than what's already there.

3. **Push it, tagged to match:**

   ```powershell
   git add .
   git commit -m "Pets redrawn, DAY ZERO skin"
   git push
   git tag v1.0.1
   git push origin v1.0.1
   ```

   Tag and version must agree — `v1.0.1` for `1.0.1`. The build checks and
   stops with a clear error if they don't, so a mismatch costs a minute, not
   a broken release.

Three to five minutes later there's a new release. Anyone with the app gets a
dialog next time they open it:

> **Version 1.0.1 is ready.**
> Your saves, skins and codes are kept. It will also install by itself next
> time you close the game.

They click **Restart now**, or ignore it and it installs when they quit.

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
