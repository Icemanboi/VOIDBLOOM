# VOIDBLOOM - tidy the project folder
#
# Moves old builds, superseded art and one-off exports into _archive\ so the
# folder shows only what is current. Nothing is deleted, ever - everything is
# moved, and you can drag anything back out.
#
# Run it by double-clicking "CLEAN UP.bat" in the VOIDBLOOM folder.
#
# ASCII-only on purpose: Windows PowerShell 5.1 reads a BOM-less .ps1 as ANSI.

$ErrorActionPreference = 'Stop'

function Line { Write-Host ("-" * 62) -ForegroundColor DarkGray }
function Info { param($m) Write-Host "       $m" -ForegroundColor DarkGray }
function Ok   { param($m) Write-Host "  ok   " -ForegroundColor Green -NoNewline; Write-Host $m }

$root = Split-Path -Parent $PSScriptRoot        # ...\VOIDBLOOM\desktop
$game = Split-Path -Parent $root                # ...\VOIDBLOOM

Set-Location $game

Clear-Host
Write-Host ""
Write-Host "  V O I D B L O O M " -ForegroundColor Cyan -NoNewline
Write-Host " tidy the folder" -ForegroundColor DarkGray
Line
Info "nothing is deleted - everything moves into _archive\"
Write-Host ""

# What is CURRENT and must stay where it is:
#   VOIDBLOOM.html            the game
#   VOIDBLOOM-itch.zip        the current itch upload
#   desktop\                  the Windows app
#   CODES\                    the code answer key
#   Music\                    the soundtrack
#   the current cover art, the readme, the rules, the itch instructions
$moves = [ordered]@{
    'old builds' = @(
        'VOIDBLOOM-1.html',
        'VOIDBLOOM-pre-classrefactor-backup.html',
        'VOIDBLOOM-pre-conquest-backup.html',
        'VOIDBLOOM-bossrework-UNUSED.html'
    )
    'superseded art' = @(
        'VOIDBLOOM-cover-OLD-superseded.png'
    )
    'old exports' = @(
        'VOIDBLOOM-crazygames.zip',
        'VOIDBLOOM-crazygames-alt.zip',
        'crazygames-build'
    )
    'notes and screenshots' = @(
        'VOIDBLOOM-review.md',
        'Claude outputs'
    )
}

$archive = Join-Path $game '_archive'
$moved = 0
$skipped = 0

foreach ($group in $moves.Keys) {
    $dest = Join-Path $archive $group
    foreach ($item in $moves[$group]) {
        $src = Join-Path $game $item
        if (-not (Test-Path $src)) { continue }
        if (-not (Test-Path $dest)) { New-Item -ItemType Directory -Force -Path $dest | Out-Null }
        $target = Join-Path $dest $item
        if (Test-Path $target) {
            Info "already archived, leaving in place: $item"
            $skipped++
            continue
        }
        try {
            Move-Item -Path $src -Destination $target -Force
            Ok "$group  <-  $item"
            $moved++
        } catch {
            Write-Host "  skip " -ForegroundColor Yellow -NoNewline
            Write-Host "$item  ($($_.Exception.Message))"
            $skipped++
        }
    }
}

Write-Host ""
Line
if ($moved -eq 0) {
    Write-Host "  Nothing to move - the folder is already tidy." -ForegroundColor White
} else {
    Write-Host "  Moved $moved item(s) into _archive\" -ForegroundColor White
}
if ($skipped -gt 0) { Info "$skipped skipped (see above)" }
Write-Host ""
Info "Still here, because they are current:"
Info "  VOIDBLOOM.html          the game"
Info "  VOIDBLOOM-itch.zip      the itch upload"
Info "  desktop\                the Windows app"
Info "  CODES\                  your code answer key - keep this out of GitHub"
Info "  Music\                  the soundtrack"
Line
Write-Host ""
Read-Host "Press Enter to close"
