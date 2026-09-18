@echo off
chcp 65001 >nul
title boy - watching folder (close this window to stop)
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERROR] Node.js was not found in PATH.
  echo         Install Node.js first, then run this file again.
  echo.
  pause
  exit /b 1
)

echo ============================================================
echo  Keeping this window open = files-data.js updates itself.
echo  Drop a new .html into this folder or games\ and the
echo  index.html page will pick it up within ~15 seconds.
echo  Close this window to stop watching.
echo ============================================================
echo.

node "%~dp0scan.js" --watch
pause
