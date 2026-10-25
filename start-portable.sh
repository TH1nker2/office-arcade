#!/usr/bin/env bash
# ============================================================
# 摸鱼游戏厅 · 便携版启动器（Linux / macOS）
#   数据全部放在本目录的 data/ 里，不写用户目录。
#   整个文件夹可以整体拷走，换机器接着用。
#   ./start-portable.sh          默认 8090
#   ./start-portable.sh 8091     换端口
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

VER=$(grep -o '"version": *"[^"]*"' version.json | head -1 | cut -d'"' -f4)
echo "摸鱼游戏厅 v${VER} [便携版] 启动中 …"
echo "数据位置： $(pwd)/data"
echo "浏览器打开： http://localhost:${PORT}"

exec ./runtime/node server.js "$PORT" --portable
