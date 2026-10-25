#!/usr/bin/env bash
# ============================================================
# 摸鱼游戏厅启动器（Linux / macOS）
#   ./start.sh            标准版，8090 端口，数据在用户目录
#   ./start.sh --portable 便携版，数据在 ./data
#   ./start.sh 8091       换端口
# ============================================================
cd "$(dirname "$0")" || exit 1

PORTABLE=0
PORT=""
for arg in "$@"; do
  case "$arg" in
    --portable) PORTABLE=1 ;;
    -*) ;;
    *) [ -z "$PORT" ] && PORT="$arg" ;;
  esac
done
[ -z "$PORT" ] && PORT=8090

if [ ! -f runtime/node ]; then
  echo "找不到 runtime/node —— 发行包不完整，请重新解压。"
  exit 1
fi

# 从 Windows 打的 tar 包偶尔会丢执行位，这里自愈一下
if [ ! -x runtime/node ]; then chmod +x runtime/node 2>/dev/null; fi
if [ ! -x runtime/node ]; then
  echo "runtime/node 没有执行权限，请手动执行： chmod +x runtime/node"
  exit 1
fi

VER=$(grep -o '"version": *"[^"]*"' version.json | head -1 | cut -d'"' -f4)
if [ "$PORTABLE" = "1" ]; then
  MODE="便携版"
  DATA="$(pwd)/data"
else
  MODE="标准版"
  case "$(uname -s)" in
    Darwin) DATA="$HOME/Library/Application Support/office-arcade" ;;
    *)      DATA="${XDG_DATA_HOME:-$HOME/.local/share}/office-arcade" ;;
  esac
fi

echo "摸鱼游戏厅 v${VER} [${MODE}] 启动中 …"
echo "数据位置： ${DATA}"
echo "浏览器打开： http://localhost:${PORT}"

if [ "$PORTABLE" = "1" ]; then
  exec ./runtime/node server.js "$PORT" --portable
else
  exec ./runtime/node server.js "$PORT"
fi
