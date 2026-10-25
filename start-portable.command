#!/usr/bin/env bash
# macOS 双击启动（便携版，数据在 ./data）
cd "$(dirname "$0")" || exit 1
exec bash start-portable.sh "$@"
