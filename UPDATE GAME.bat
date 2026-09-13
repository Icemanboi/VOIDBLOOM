@echo off
rem Double-click this to ship an update.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "tools\update.ps1"
if errorlevel 1 pause
