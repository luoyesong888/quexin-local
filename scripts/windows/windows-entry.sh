#!/usr/bin/env bash
set -euo pipefail

action="${1:-check}"
bundle_dir="${2:-}"
install_dir="${3:-${HOME}/.local/share/quexin/quexin-local}"
case "$action" in check|plan|install|start|status|stop|verify|doctor) ;; *) printf '%s\n' 'Unsupported action.' >&2; exit 2;; esac
if [[ "$(uname -s)" != Linux ]] || [[ ! "$(uname -r)" =~ [Mm]icrosoft ]]; then
  printf '%s\n' '请通过 Windows 的 WSL2 Ubuntu 运行此入口。' >&2; exit 2
fi
if [[ $EUID -eq 0 ]]; then
  printf '%s\n' '请先设置 Ubuntu 普通用户；不要 sudo 整个鹊信安装器。' >&2; exit 2
fi
# Support user-scoped Linux Node installations without executing shell profiles.
export PATH="$HOME/.local/bin:$PATH"
if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
  printf '%s\n' 'WSL 内缺少 Node.js/npm。请按 DEPLOY_WINDOWS_WSL.md 安装 Linux 版 Node.js 22.12+。' >&2; exit 2
fi
node -e 'const [a,b]=process.versions.node.split(".").map(Number);if(process.platform!=="linux"||a<22||(a===22&&b<12)){console.error("需要 WSL 内的 Linux Node.js 22.12+，不能使用 Windows node.exe");process.exit(2)}'
[[ "$install_dir" == /* ]] || { printf '%s\n' '安装目录必须是 Linux 绝对路径。' >&2; exit 2; }
install_dir="$(realpath -m -- "$install_dir")"
case "$install_dir" in /|"$HOME"|/home|/usr|/etc|/var|/opt|/mnt|/mnt/*) printf '%s\n' '安装位置不安全；请选择 Linux 用户目录下的专用文件夹。' >&2; exit 2;; esac
if [[ -n "${QUEXIN_LOCAL_DATA:-}" ]]; then
  [[ "$QUEXIN_LOCAL_DATA" == /* ]] || { printf '%s\n' '数据目录必须是 Linux 绝对路径。' >&2; exit 2; }
  data_path="$(realpath -m -- "$QUEXIN_LOCAL_DATA")"
  case "$data_path" in /mnt|/mnt/*) printf '%s\n' '数据目录必须位于 Linux 文件系统，不能使用 Windows 挂载盘。' >&2; exit 2;; esac
fi
# Do not inherit a Windows or foreign Node installation's package tree.
export PG_BIN="${PG_BIN:-/usr/lib/postgresql/17/bin}"
unpack=''
cleanup(){ if [[ -n "$unpack" && -d "$unpack" ]]; then rm -rf -- "$unpack"; fi; }
trap cleanup EXIT
if [[ "$action" == check || "$action" == plan || "$action" == install ]]; then
  [[ -d "$bundle_dir" ]] || { printf '%s\n' '找不到完整部署包目录。' >&2; exit 2; }
  shopt -s nullglob
  archives=("$bundle_dir"/quexin-local-windows-wsl-v*.tar.gz)
  [[ ${#archives[@]} -eq 1 ]] || { printf '%s\n' '部署包应包含且仅包含一个 Windows WSL 程序归档。' >&2; exit 2; }
  archive="${archives[0]}"
  [[ -f "$archive.sha256" ]] || { printf '%s\n' '缺少归档校验文件。' >&2; exit 2; }
  ( cd "$bundle_dir"; sha256sum --check --status "$(basename "$archive").sha256" )
  # Never extract archive links or traversal entries.
  while IFS= read -r entry; do
    case "$entry" in quexin-local|quexin-local/|quexin-local/*) ;; *) printf '%s\n' '归档根目录无效。' >&2; exit 2;; esac
    [[ ! "$entry" =~ (^|/)\.\.(/|$) ]] || { printf '%s\n' '归档包含越界路径。' >&2; exit 2; }
  done < <(tar -tzf "$archive")
  if tar -tvzf "$archive" | awk 'substr($1,1,1)=="l" || substr($1,1,1)=="h" {found=1} END {exit !found}'; then
    printf '%s\n' '归档包含链接，已拒绝。' >&2; exit 2
  fi
  unpack="$(mktemp -d -t quexin-wsl-install-XXXXXXXX)"
  tar --no-same-owner -xzf "$archive" -C "$unpack"
  node "$unpack/quexin-local/scripts/release-verify.mjs" "$unpack/quexin-local" --json
  if [[ -e "$install_dir" ]]; then
    [[ -d "$install_dir" && ! -L "$install_dir" && -f "$install_dir/release-manifest.json" ]] || { printf '%s\n' '目标已存在且不是已识别安装，未覆盖。' >&2; exit 2; }
    if [[ "$action" == install ]] && ! cmp -s "$install_dir/release-manifest.json" "$unpack/quexin-local/release-manifest.json"; then
      printf '%s\n' '目标已有另一版本。未覆盖程序或数据；请按文档先备份并显式升级。' >&2; exit 2
    fi
    project="$install_dir"
  else
    project="$unpack/quexin-local"
  fi
  ( cd "$project"; node scripts/workbuddy-preflight.mjs --json )
  if [[ "$action" == check ]]; then printf '预检结束，未安装。目标：%s\n' "$install_dir"; exit 0; fi
  if [[ "$action" == plan ]]; then printf '安装计划：保留已有数据，将程序安装到 %s，安装 npm 依赖并启动本机服务。\n' "$install_dir"; exit 0; fi
  if [[ ! -e "$install_dir" ]]; then
    mkdir -p -- "$(dirname "$install_dir")"
    mv -T --no-clobber -- "$unpack/quexin-local" "$install_dir"
    [[ ! -e "$unpack/quexin-local" ]] || { printf '%s\n' '目标在安装期间发生变化，未覆盖。' >&2; exit 2; }
  fi
  cd "$install_dir"
  node scripts/workbuddy-deploy.mjs install --yes
else
  [[ -d "$install_dir" && ! -L "$install_dir" && -f "$install_dir/release-manifest.json" ]] || { printf '%s\n' '尚未安装，或安装目录无效。请先运行 Install。' >&2; exit 2; }
  cd "$install_dir"
  node scripts/workbuddy-deploy.mjs "$action"
fi
