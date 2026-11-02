#!/bin/zsh
set -u
SCRIPT_DIR="${0:A:h}"
cd "$SCRIPT_DIR" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "鹊信暂不能部署：未找到 Node.js。"
  echo "请先安装 Node.js 22.12 或更新版本，再让 WorkBuddy 重新运行本检查。"
  echo "本检查没有安装软件，也没有修改任何资料。"
  exit 1
fi

exec node scripts/workbuddy-preflight.mjs "$@"
