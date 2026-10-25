#!/usr/bin/env bash
# ============================================================
# 摸鱼游戏厅启动器（Linux / macOS）
#   ./start.sh            默认 8090 端口
#   ./start.sh 8091       指定端口
# ============================================================
cd "$(dirname "$0")" || exit 1

if [ ! -f runtime/node ]; then
  echo "找不到 runtime/node —— 发行包不完整，请重新解压。"
  exit 1
fi

# 从 Windows 打的 tar 包偶尔会丢执行位，这里自愈一下
if [ ! -x runtime/node ]; then
  chmod +x runtime/node 2>/dev/null
fi
if [ ! -x runtime/node ]; then
  echo "runtime/node 没有执行权限，请手动执行： chmod +x runtime/node"
  exit 1
fi

PORT="${1:-8090}"
echo "摸鱼游戏厅 v$(grep -o '"version": *"[^"]*"' version.json | head -1 | cut -d'"' -f4) 启动中 …"
echo "浏览器打开： http://localhost:${PORT}"
exec ./runtime/node server.js "$PORT"
