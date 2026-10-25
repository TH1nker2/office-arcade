@echo off
rem ============================================================
rem  OFFICE ARCADE - fetch Node.js runtime (developers only)
rem
rem  Keep this file pure ASCII, same reason as the launcher:
rem  Chinese text in a .bat gets mis-parsed depending on the console
rem  code page and can be executed as a command.
rem ============================================================
chcp 65001 >nul 2>nul
setlocal
cd /d "%~dp0"

echo.
echo   OFFICE ARCADE  ^|  fetch Node.js runtime
echo   --------------------------------------------------
echo   Release packages already ship runtime\node.exe, so you do
echo   NOT need this script there.
echo   Only needed when running from a git clone: it downloads
echo   Node.js into runtime\node.exe (about 90 MB, one time).
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\fetch-runtime.ps1"

echo.
if exist "%~dp0runtime\node.exe" (
  echo   Done. You can now double-click the launcher.
) else (
  echo   [FAILED] download did not succeed, check the network and retry.
)
pause
