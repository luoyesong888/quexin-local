# Windows + WSL2 部署包准备记录

日期：2026-11-04。

状态：**Windows + WSL2 预览包已制作，尚未完成 Windows 实机验收。不是原生 Windows EXE/MSI。**

## 已实现

- PowerShell 入口通过参数调用 wsl.exe，检查发行版的 WSL2 状态，转换包路径并执行 Bash 入口；不拼接动态 shell 代码，不修改全局执行策略。
- Bash 入口拒绝非 WSL 主机、root 用户、非 Linux Node、相对安装路径和 Windows 挂载盘；校验归档后在 Linux 文件系统安装，已有不同版本不覆盖。
- 提供 Check、Plan、Install、Start、Status、Stop、Verify、Doctor。
- 预检识别 WSL，使用 Windows 宿主浏览器，发现 Linux PostgreSQL 17 工具；始终提示需要 Windows 浏览器实测。
- 发布校验、打包和升级临时目录改用系统临时目录，避免 Linux 缺少 `/private/tmp`。
- Linux 卸载后的可恢复内容放入 `~/.local/share/quexin/recovery/`，不冒充 Windows 回收站。
- 专用 `windows-wsl` 发布目标在清单中明确标记 Linux 运行时、Windows 宿主与未实测状态；macOS 目标保持独立。

## 已验证

- `node --test tests/workbuddy-preflight.test.mjs tests/release-bundle.test.mjs tests/windows-wsl-package.test.mjs tests/workbuddy-lifecycle.test.mjs`：13 项通过。覆盖 WSL 预检分支、root/挂载盘/原生 Windows 拒绝、旧数据保留、Windows 包元数据、归档校验及 macOS 升级回滚。
- `bash -n scripts/windows/windows-entry.sh`：语法通过；在当前 macOS 运行入口会在安装前明确拒绝。
- `node scripts/test-local-runtime.mjs`：当前 macOS 环境的五组件托管、备份恢复、端口保护和重启回归通过。
- `npm run build`：通过，保留既有单个 JS 包大于 500 kB 的提示。
- 最终 ZIP 的 CRC、全部外层文件 SHA-256 和内层发布归档校验通过；内层包含 159 个程序文件。

首轮静态规则把说明注释里的 `bash -c` 当成调用，排除注释后复验通过；没有改变产品行为或放宽执行断言。

## 未验证

没有 Windows/WSL2 测试机，也没有 PowerShell 运行时，因此 PowerShell 文件只做人工与静态检查，未执行 PowerShell 解析器。尚未验证目标 Windows 的 WSL 初始化、Ubuntu 依赖安装、Windows localhost 转发、宿主浏览器登录/保存、WSL 退出或 Windows 重启后的操作。不能以 macOS 测试代替这些步骤。

## 交付

`release/artifacts/windows-wsl-20261104/鹊信-项目本地部署包-Windows-WSL2-预览版-20261104.zip`

大小 10,118,485 字节，SHA-256：`2f89939779416fcfc9163cfb37dada5d9dbcfccdc346c878ce2554cd605f560e`。

包内有 Windows 指令、验证范围、PowerShell/Bash 脚本、双击入口、项目归档与校验清单；没有宣传视频、真实聊天、数据库、账号或 API 密钥。接手 Agent 应按 `DEPLOY_WINDOWS_WSL.md` 在用户的 Windows 电脑完成实际验收。

依据微软官方 WSL 安装、文件系统和本机网络说明，以及 PostgreSQL 官方 Ubuntu 安装说明，链接已列入部署文档。
