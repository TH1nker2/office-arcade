@echo off
chcp 65001 >nul
setlocal
title 摸鱼游戏厅 - 局域网服务器（便携版）
cd /d "%~dp0"

rem ============================================================
rem  便携版：数据全部放在本目录的 data 文件夹里，不写 C 盘用户目录。
rem  适合放 U 盘、或者不想在系统里留痕的场景。整个文件夹拷走就搬家。
rem ============================================================

set "NODE_EXE=%~dp0runtime\node.exe"
if not exist "%NODE_EXE%" goto NONODE

echo.
echo   摸鱼游戏厅 · OFFICE ARCADE  [便携版]
echo   ------------------------------------------------
echo   运行环境： runtime\node.exe
echo   数据位置： %~dp0data
echo   正在启动局域网服务器（端口 8090）...
echo   浏览器会自动打开；把终端里的「局域网访问」地址发给同事。
echo   关闭此窗口即可停止服务器。整个文件夹可以整体拷走。
echo.
"%NODE_EXE%" server.js 8090 --open --portable
echo.
echo   服务器已停止。
pause
exit /b 0

:NONODE
echo.
echo   [提示] 没有找到 runtime\node.exe
echo.
echo   发行包里应该自带运行时；如果是自己克隆的源码，请先双击「获取运行环境.bat」。
echo.
pause
exit /b 1
