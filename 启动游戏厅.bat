@echo off
rem ============================================================
rem  OFFICE ARCADE - LAN server launcher
rem
rem  IMPORTANT: keep this file pure ASCII.
rem  Chinese text inside a .bat gets mis-parsed by cmd.exe when the
rem  console code page differs (936 / 65001 / 437): a multi-byte
rem  sequence is split and the tail runs as a command, showing up
rem  as "<text> is not recognized as an internal or external command".
rem  All Chinese messages are printed by Node in the startup banner.
rem ============================================================
chcp 65001 >nul 2>nul
setlocal
cd /d "%~dp0"

set "NODE_EXE=%~dp0runtime\node.exe"
if not exist "%NODE_EXE%" goto NONODE

echo.
echo   OFFICE ARCADE  ^|  LAN server
echo   --------------------------------------------------
echo   runtime : runtime\node.exe
echo   data    : %~dp0data
echo   port    : 8090
echo.
echo   Starting... the browser opens automatically.
echo   Send the LAN address printed below to your colleagues.
echo   Close this window to stop the server.
echo.

"%NODE_EXE%" server.js 8090 --open

echo.
echo   Server stopped.
pause
exit /b 0

:NONODE
echo.
echo   [ERROR] runtime\node.exe not found.
echo.
echo   Run the "get runtime" script first (needs internet once),
echo   or put node.exe into the runtime folder next to this file.
echo.
pause
exit /b 1
