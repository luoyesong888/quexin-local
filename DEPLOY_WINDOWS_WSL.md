# Windows 本地部署：WSL2 预览版

这份包使用 **Windows + WSL2 + Ubuntu** 运行鹊信，再用 Windows 浏览器访问。它不是原生 Windows EXE/MSI，也不能直接用 Windows 的 node.exe 运行本机服务。

当前验证范围：PowerShell 入口人工检查、Bash 语法与拒绝非 WSL 主机、WSL 预检分支自动测试、发布清单/哈希校验，以及同一源码在 macOS 的本地回归。**尚未在 Windows 实机或 WSL2 实例中完成安装与浏览器验收，请由接手 Agent 在目标电脑继续验证。**

## 1. 准备 WSL2

微软当前的简化安装命令要求 Windows 11，或 Windows 10 2004 / Build 19041 及以上。先在 PowerShell 查询：

```powershell
wsl --status
wsl --list --verbose
```

未安装时，按微软官方说明，在用户同意系统变更后以管理员 PowerShell 执行：

```powershell
wsl --install -d Ubuntu
```

可能需要重启电脑。第一次打开 Ubuntu，完成普通 Linux 用户和密码设置。不要使用 root 运行鹊信安装器。确认所选发行版的 VERSION 为 2；如果名称是 `Ubuntu-24.04` 等，后续传入实际名称。

官方说明：https://learn.microsoft.com/windows/wsl/install

## 2. 在 Ubuntu 内准备运行环境

所有程序依赖必须是 **WSL 内的 Linux 版本**：

- Node.js >=22.12、npm。
- PostgreSQL 17，包含 pg_ctl / initdb / pg_dump / pg_restore。
- tar、sha256sum、realpath、cmp、bash（Ubuntu 常规安装通常具备）。

先查看 `node --version`、`node -p process.platform`（应为 linux）及 `/usr/lib/postgresql/17/bin/pg_ctl --version`。入口会把 `~/.local/bin` 加入 PATH。可以在确认该目录没有同名工具冲突后，为已安装的 Linux Node/npm 建立指向此目录的符号链接。如果使用 nvm，确保从非交互 WSL 命令也能找到所选版本；入口不会自行执行用户的 shell 配置文件。不要误用 Windows 安装的 Node。

Node 官方下载：https://nodejs.org/en/download

Ubuntu 默认 PostgreSQL 版本可能不是 17。Agent 应按 PostgreSQL 官方 Ubuntu 指南安装 17，不卸载机器上其他版本、不重置系统集群。官方方式包括：

```bash
sudo apt install -y postgresql-common
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh
sudo apt update
sudo apt install postgresql-17
```

系统级安装需要用户/宿主权限流程。完成后，鹊信会用 5543 端口建立自己的独立数据目录，不借用或清空系统 PostgreSQL 的默认数据库。

官方说明：https://www.postgresql.org/download/linux/ubuntu/

## 3. PowerShell 部署入口

在 Windows 解压完整 ZIP，进入含 `Deploy-Quexin.ps1` 的文件夹：

```powershell
.\Deploy-Quexin.ps1 -Action Check -Distribution Ubuntu
.\Deploy-Quexin.ps1 -Action Plan -Distribution Ubuntu
.\Deploy-Quexin.ps1 -Action Install -Distribution Ubuntu
```

如果执行策略阻止本地脚本，先检查并按组织/用户现有策略处理，不要全局关闭安全策略。必要时让 Agent 直接在 WSL 中执行同包的 `windows-entry.sh`，并传入明确的动作、部署包的 Linux 路径和安装目录。

PowerShell 入口只调用已有 wsl.exe，不自动安装 WSL，不更改防火墙，不自动重启 Windows，不购买或配置外部模型。`Install` 是明确的安装动作，先验证归档，再安装锁定 npm 依赖和本项目数据库。

默认程序位置：

```text
/home/<你的Linux用户名>/.local/share/quexin/quexin-local
```

可以用 `-InstallDirectory '/home/用户名/你选择的专用目录'` 改位置，后续每次命令使用同一个参数。程序、数据库与交换箱必须在 Linux 文件系统，不要放在 `/mnt/c`、`/mnt/d` 或 OneDrive 文件夹里。

如果已有另一份安装，脚本不会覆盖；应先在 WSL 内备份，再按产品的升级说明处理。不要通过删除 `.local-data` 来解决安装报错。

## 4. 启动、检查和停止

```powershell
.\Deploy-Quexin.ps1 -Action Start -Distribution Ubuntu
.\Deploy-Quexin.ps1 -Action Verify -Distribution Ubuntu
.\Deploy-Quexin.ps1 -Action Status -Distribution Ubuntu
.\Deploy-Quexin.ps1 -Action Doctor -Distribution Ubuntu
.\Deploy-Quexin.ps1 -Action Stop -Distribution Ubuntu
```

默认从 Windows Edge/Chrome 打开：`http://127.0.0.1:4188/`。以安装器实际输出为准。WSL 内的 verify 通过后，还必须实际从 Windows 浏览器验证页面加载、登录和资料保存。正常情况下 WSL 支持从 Windows 用 localhost 访问；VPN、代理或自定义 WSL 网络可能影响它。

如端口被占用，Agent 应选择四个空闲端口，在 WSL 内首次安装前设置 WEB_PORT、LOCAL_API_PORT、LOCAL_MOCK_PORT、LOCAL_PG_PORT，再运行脚本；不要结束不相关进程。

官方网络说明：https://learn.microsoft.com/windows/wsl/networking

`wsl --shutdown`、电脑重启或发行版退出会停止服务；再次使用时执行 Start。本包不承诺 Windows 开机自动启动。

## 5. 数据与 WorkBuddy 聊天交接

- 数据库、归档与媒体默认在上述安装目录的 `.local-data/`。
- 浏览器私人资料在 Windows 当前浏览器的资料库，仍需产品内 JSON 备份。
- 不要把 macOS 的 PostgreSQL 数据目录直接复制到 Windows/WSL；需要通过数据库备份恢复或正式导入流程迁移。
- Windows 文件管理器可以通过 `\\wsl$\Ubuntu\home\用户名\...` 查看 WSL 文件；这不改变文件的私有范围。
- 如果 WorkBuddy 在 Windows 导出聊天，先把源目录用 `wslpath` 转为 `/mnt/c/...`，再在 WSL 内运行 `workbuddy-chat-bridge.mjs convert`。原导出只读，输出交换箱放在 `/home/用户名/WorkBuddy/鹊信交换箱` 一类 Linux 目录。
- 青鸟里填写的是 **Linux 交换箱绝对路径**，不是 `C:\...`。确认读取后才归档，外部模型发送仍需逐次确认。
- 通过 Windows 直接写入 WSL 的交接文件也必须符合目录 0700、文件 0600；推荐让 WSL 内的转换器生成文件，不批量放宽权限。
- Linux 下卸载工具的恢复保留目录为 `~/.local/share/quexin/recovery/`，不是 Windows 回收站。任何删除/卸载需单独授权。

文件系统建议：https://learn.microsoft.com/windows/wsl/filesystems

## 给其他 Agent 的任务

请根据本说明在目标 Windows 机器检查 WSL2、Ubuntu 普通用户、Linux Node 与 PostgreSQL 17，实际执行 Check / Plan / Install / Verify，并从 Windows 浏览器验证。报告实际通过与未通过项；不要将“脚本已准备”或“WSL 内 health 返回正常”描述成 Windows 浏览器验收完成。包中不含真实资料、账号、API Key 或宣传视频。
