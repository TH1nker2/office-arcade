@echo off
chcp 65001 >nul
setlocal
title 摸鱼游戏厅 - 局域网服务器（标准版）
cd /d "%~dp0"

rem ---- 只用工程自带的运行时，不查系统 PATH ----
set "NODE_EXE=%~dp0runtime\node.exe"
if not exist "%NODE_EXE%" goto NONODE

echo.
echo   摸鱼游戏厅 · OFFICE ARCADE  [标准版]
echo   ------------------------------------------------
echo   运行环境： runtime\node.exe
echo   数据位置： %%APPDATA%%\office-arcade
echo   正在启动局域网服务器（端口 8090）...
echo   浏览器会自动打开；把终端里的「局域网访问」地址发给同事。
echo   关闭此窗口即可停止服务器。
echo.
"%NODE_EXE%" server.js 8090 --open
echo.
echo   服务器已停止。
pause
exit /b 0

:NONODE
echo.
echo   [提示] 没有找到 runtime\node.exe
echo.
echo   请先双击「获取运行环境.bat」下载（需要联网一次），
echo   或者手动把 node.exe 放到本目录的 runtime 文件夹里。
echo.
pause
exit /b 1
