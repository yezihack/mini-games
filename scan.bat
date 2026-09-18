@echo off
chcp 65001 >nul
title boy - scan once
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

node "%~dp0scan.js" %*
echo.
pause
