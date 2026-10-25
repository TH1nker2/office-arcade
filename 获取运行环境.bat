@echo off
chcp 65001 >nul
setlocal
title 获取运行环境 - Node.js
cd /d "%~dp0"

echo.
echo   摸鱼游戏厅 · 运行环境下载（仅开发者需要）
echo   ------------------------------------------------
echo   发行版里已经自带 runtime\node.exe，不需要跑这个脚本。
echo   只有从 git 克隆源码时才需要：
echo   它会把 Node.js 下载到 runtime\node.exe（约 90 MB，只需一次）
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\fetch-runtime.ps1"

echo.
if exist "%~dp0runtime\node.exe" (
  echo   搞定，现在可以双击「启动游戏厅.bat」了。
) else (
  echo   [失败] 没能下载成功，请检查网络后重试。
)
pause
