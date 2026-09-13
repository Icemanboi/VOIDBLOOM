@echo off
REM ---------------------------------------------------------------------
REM  Puts the macOS build workflow where GitHub Actions looks for it.
REM
REM  Workflow files are protected from remote writes, so release.yml was
REM  dropped into tools\ instead. This moves it the last step. Run it once;
REM  after that it has nothing to do and will say so.
REM ---------------------------------------------------------------------
setlocal
cd /d "%~dp0"

if not exist "tools\release.yml" (
  echo.
  echo   Nothing to install - tools\release.yml is not here.
  echo.
  if exist ".github\workflows\release.yml" (
    findstr /c:"macos-latest" ".github\workflows\release.yml" >nul 2>&1
    if not errorlevel 1 (
      echo   Good news: the mac job is already in .github\workflows\release.yml,
      echo   so this was probably run already. Nothing to do.
    ) else (
      echo   Warning: .github\workflows\release.yml exists but has no mac job.
      echo   Ask Claude for release.yml again.
    )
  )
  echo.
  pause
  exit /b 0
)

if not exist ".github\workflows" mkdir ".github\workflows"

copy /y "tools\release.yml" ".github\workflows\release.yml" >nul
if errorlevel 1 (
  echo.
  echo   Copy failed. Is the file open in an editor?
  echo.
  pause
  exit /b 1
)

findstr /c:"macos-latest" ".github\workflows\release.yml" >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Copied, but the mac job is missing from the result. Stopping so
  echo   you do not ship a half-applied change.
  echo.
  pause
  exit /b 1
)

del "tools\release.yml"

echo.
echo   Done. .github\workflows\release.yml now builds Windows AND macOS.
echo.
echo   Next: run "UPDATE GAME.bat" as usual. The release it makes will
echo   carry the .exe plus two .dmg files for Mac.
echo.
pause
