#!/usr/bin/env bash
# macOS 双击启动（Finder 里双击这个文件）
cd "$(dirname "$0")" || exit 1
exec bash start.sh "$@"
