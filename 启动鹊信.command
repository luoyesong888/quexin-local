#!/bin/zsh
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd -- "$(dirname -- "$0")" || exit 1
if npm run local:start; then
  open "$(node --input-type=module -e 'import fs from "node:fs";const c=JSON.parse(fs.readFileSync(".local-data/runtime/config.json","utf8"));console.log(`http://127.0.0.1:${c.webPort}/`)')"
fi
read "?按回车关闭窗口，后台服务仍会继续运行。"
