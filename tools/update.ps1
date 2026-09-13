# VOIDBLOOM - ship an update
#
# Copies the latest game file in, bumps the version, commits, tags and
# pushes. GitHub builds the installer and everyone's copy updates itself.
#
# Run it by double-clicking "UPDATE GAME.bat" one folder up.
#
# Deliberately ASCII-only: Windows PowerShell 5.1 reads .ps1 files without a
# BOM as ANSI, so a stray curly quote or dash in here becomes mojibake.

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------- helpers
function Line { param($c = 'DarkGray') Write-Host ("-" * 62) -ForegroundColor $c }
function Say  { param($m, $c = 'Gray')  Write-Host $m -ForegroundColor $c }
function Ok   { param($m) Write-Host "  ok   " -ForegroundColor Green -NoNewline; Write-Host $m }
function Info { param($m) Write-Host "       " -NoNewline; Write-Host $m -ForegroundColor DarkGray }

function Stop-Here {
    param($m, $hint)
    Write-Host ""
    Write-Host "  STOP  " -ForegroundColor Red -NoNewline
    Write-Host $m -ForegroundColor White
    if ($hint) { Write-Host "        $hint" -ForegroundColor DarkGray }
    Write-Host ""
    Read-Host "Press Enter to close"
    exit 1
}

function Git-Do {
    param([string[]]$GitArgs, [string]$What)
    & git @GitArgs
    if ($LASTEXITCODE -ne 0) {
        Stop-Here "git $($GitArgs -join ' ') failed." $What
    }
}

# ---------------------------------------------------------------- setting up
$root = Split-Path -Parent $PSScriptRoot      # the desktop folder
Set-Location $root

Clear-Host
Write-Host ""
Write-Host "  V O I D B L O O M " -ForegroundColor Cyan -NoNewline
Write-Host " ship an update" -ForegroundColor DarkGray
Line

# --- things that must be true before we touch anything
if (-not (Test-Path (Join-Path $root 'package.json'))) {
    Stop-Here "Can't find package.json." "This script has to live in desktop\tools\."
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Stop-Here "Git isn't installed." "Get it from git-scm.com, then run this again."
}
if (-not (Test-Path (Join-Path $root '.git'))) {
    Stop-Here "This folder isn't a git repository yet." "Do the one-time setup in SETUP.md first."
}
if (-not (Test-Path (Join-Path $root '.github\workflows\release.yml'))) {
    Stop-Here "The build script isn't in place." "Step 1 of SETUP.md moves release-workflow.yml into .github\workflows\."
}

# ---------------------------------------------------------------- 1. the game file
Say "1. the game file" 'Cyan'

$dest = Join-Path $root 'game\VOIDBLOOM.html'
$src  = Join-Path (Split-Path -Parent $root) 'VOIDBLOOM.html'   # ..\VOIDBLOOM.html

if (Test-Path $src) {
    $srcHash  = (Get-FileHash $src  -Algorithm SHA256).Hash
    $destHash = if (Test-Path $dest) { (Get-FileHash $dest -Algorithm SHA256).Hash } else { '' }
    if ($srcHash -ne $destHash) {
        Copy-Item $src $dest -Force
        Ok "copied the newer VOIDBLOOM.html in"
    } else {
        Ok "game file already up to date"
    }
} else {
    Info "no VOIDBLOOM.html one folder up - using the copy already in game\"
}

if (-not (Test-Path $dest)) { Stop-Here "game\VOIDBLOOM.html is missing." }

# --- the same checks the build runs, so a mistake costs seconds not minutes
$bytes = (Get-Item $dest).Length
$text  = [System.IO.File]::ReadAllText($dest, [System.Text.Encoding]::UTF8)

if ($bytes -lt 100000) {
    Stop-Here "game\VOIDBLOOM.html is only $bytes bytes." "That looks like the wrong file."
}
if ($text -notmatch 'boot\(\);') {
    Stop-Here "game\VOIDBLOOM.html has no boot() call." "That isn't a playable build."
}
if ($text -match '__VB') {
    Stop-Here "game\VOIDBLOOM.html contains the __VB debug hook." "That's TEST_BUILD.html, not the shipping file. Copy the real one in."
}
Ok ("checks passed  (" + [math]::Round($bytes / 1KB) + " KB)")

# ---------------------------------------------------------------- 2. the version
Write-Host ""
Say "2. the version" 'Cyan'

$pkgPath = Join-Path $root 'package.json'
$pkgText = [System.IO.File]::ReadAllText($pkgPath, [System.Text.Encoding]::UTF8)

if ($pkgText -notmatch '"version"\s*:\s*"(\d+)\.(\d+)\.(\d+)"') {
    Stop-Here "Couldn't read the version out of package.json."
}
$maj = [int]$Matches[1]; $min = [int]$Matches[2]; $pat = [int]$Matches[3]
$current = "$maj.$min.$pat"
$suggest = "$maj.$min.$($pat + 1)"

Info "currently $current"
Write-Host ""
Write-Host "       next version [" -NoNewline -ForegroundColor DarkGray
Write-Host $suggest -NoNewline -ForegroundColor Yellow
Write-Host "]  - Enter to accept, or type your own: " -NoNewline -ForegroundColor DarkGray
$typed = Read-Host

$newVer = if ([string]::IsNullOrWhiteSpace($typed)) { $suggest } else { $typed.Trim().TrimStart('v') }

if ($newVer -notmatch '^\d+\.\d+\.\d+$') {
    Stop-Here "'$newVer' isn't a version number." "It has to look like 1.2.3"
}

# it must go UP, or auto-update will refuse to install it
$curV = [version]$current
$newV = [version]$newVer
if ($newV -le $curV) {
    Stop-Here "$newVer is not higher than $current." "Auto-update only installs versions that go up."
}

# and the tag must not already exist
& git rev-parse -q --verify "refs/tags/v$newVer" 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
    Stop-Here "Tag v$newVer already exists." "Pick a higher number, or delete the old tag (see SETUP.md)."
}

# ---------------------------------------------------------------- 3. what changed
Write-Host ""
Say "3. what changed" 'Cyan'
Write-Host "       describe it in a few words: " -NoNewline -ForegroundColor DarkGray
$msg = Read-Host
if ([string]::IsNullOrWhiteSpace($msg)) { $msg = "Update to $newVer" }

# ---------------------------------------------------------------- 4. do it
Write-Host ""
Line
Write-Host "  $current  ->  " -NoNewline -ForegroundColor DarkGray
Write-Host $newVer -ForegroundColor Yellow -NoNewline
Write-Host "     `"$msg`"" -ForegroundColor DarkGray
Line
Write-Host "  Enter to ship, or close this window to cancel: " -NoNewline -ForegroundColor White
Read-Host | Out-Null

Write-Host ""
Say "4. shipping" 'Cyan'

# Write the new version, preserving the rest of the file byte for byte, and
# with no BOM - a BOM in package.json breaks some JSON readers.
#
# Note the instance form. [regex]::Replace(input, pattern, replacement, 1)
# looks like "replace the first match" but there is no such static overload:
# the 1 binds to RegexOptions, where it means IgnoreCase. Only the instance
# method takes a count.
$rx = New-Object System.Text.RegularExpressions.Regex('("version"\s*:\s*")\d+\.\d+\.\d+(")')
$pkgText = $rx.Replace($pkgText, "`${1}$newVer`${2}", 1)
[System.IO.File]::WriteAllText($pkgPath, $pkgText, (New-Object System.Text.UTF8Encoding($false)))
Ok "package.json now says $newVer"

Git-Do @('add', '-A') "Nothing to add?"

# an empty commit is fine if only the version moved, but git errors on it,
# so check whether there is anything staged at all
& git diff --cached --quiet
$nothingStaged = ($LASTEXITCODE -eq 0)
if ($nothingStaged) {
    Info "no file changes - tagging the current commit"
} else {
    Git-Do @('commit', '-m', $msg) "Set your name and email: git config --global user.name ""Isaac"" and user.email ""you@example.com"""
    Ok "committed"
    Git-Do @('push') "If this is the first push, run: git push -u origin main"
    Ok "pushed"
}

Git-Do @('tag', "v$newVer") $null
Git-Do @('push', 'origin', "v$newVer") $null
Ok "tagged v$newVer and pushed - the build has started"

# ---------------------------------------------------------------- done
$url = 'https://github.com/Icemanboi/VOIDBLOOM'
Write-Host ""
Line 'Cyan'
Write-Host "  Done. GitHub is building the installer now - about 3 to 5 minutes." -ForegroundColor White
Write-Host ""
Info "watch it:    $url/actions"
Info "download:    $url/releases"
Write-Host ""
Info "Anyone with the app installed gets a notice at the bottom of the"
Info "game window next time they open it. Their saves are kept."
Line 'Cyan'
Write-Host ""

Write-Host "  Open the Actions page now? [Y/n] " -NoNewline -ForegroundColor DarkGray
$open = Read-Host
if ($open -notmatch '^[nN]') { Start-Process "$url/actions" }

Write-Host ""
Read-Host "Press Enter to close"
