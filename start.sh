#!/usr/bin/env bash
# ============================================================
# 摸鱼游戏厅启动器（Linux / macOS）
#   数据固定放在本目录的 data/ 下，整个文件夹可以整体拷走
#   ./start.sh          默认 8090
#   ./start.sh 8091     换端口
# ============================================================
cd "$(dirname "$0")" || exit 1

PORT="${1:-8090}"

if [ ! -f runtime/node ]; then
  echo "找不到 runtime/node —— 发行包不完整，请重新解压。"
  exit 1
fi
if [ ! -x runtime/node ]; then chmod +x runtime/node 2>/dev/null; fi
if [ ! -x runtime/node ]; then
  echo "runtime/node 没有执行权限，请手动执行： chmod +x runtime/node"
  exit 1
fi

VER=$(grep -o '"'"'"version": *"[^"]*"'"'"' version.json | head -1 | cut -d'"'"'"'"'"' -f4)
echo "摸鱼游戏厅 v${VER} 启动中 …"
echo "数据位置： $(pwd)/data"
echo "浏览器打开： http://localhost:${PORT}"

exec ./runtime/node server.js "$PORT"
