# 使用 WorkBuddy 部署鹊信本地版

## WorkBuddy 文件夹交接（F2 开发阶段）

当前已具备转换器、安全收件箱和后台清单发现能力；聊天归档/检索、青鸟范围确认界面将在 F3/F4 接入。`ready` 状态只表示文件校验通过，**不表示已生成回忆或完成共享**。

WorkBuddy 和鹊信在同一电脑上交接文件。“交换箱”不等于双方可见的共享聊天库。原始聊天放在源码目录以外，鹊信只访问明确配置的目录。当前不会遥控 WorkBuddy，也不会扫描微信。操作命令由当前本机用户执行；未来网页绑定账号时必须使用服务端登录身份，不能信任浏览器提交的账号 ID。

先用真实账号/空间 ID 配置交换箱（请替换示例路径）：

```bash
npm run workbuddy:inbox -- configure --inbox '/完整路径/鹊信交换箱' --owner-id '本机账号ID' --space-id '空间ID' --yes
```

ID 使用英文字母、数字、点、连字符或下划线，开头为字母或数字。默认本机状态保存到 `.local-data/workbuddy-inbox/`，支持 `QUEXIN_LOCAL_DATA` 或 `--data-root`。交换箱必须在项目目录外；已有目录须归当前用户所有且权限为 `0700`，文件为 `0600`。程序会拒绝宽权限目录，不会擅自修改现有目录权限。

将已获授权的 WorkBuddy 导出转换成批次：

```bash
npm run workbuddy:chat -- convert --source '/完整路径/已授权导出' --inbox '/完整路径/鹊信交换箱' --space-id '空间ID' --conversation-id '稳定会话ID'
```

转换器先写 `staging`，文件完成后原子移入 `ready`。随后运行以下命令查看清单；只读取 manifest，不打开聊天分块和图片：

```bash
npm run workbuddy:inbox -- scan --owner-id '本机账号ID' --space-id '空间ID'
npm run workbuddy:inbox -- status --owner-id '本机账号ID' --space-id '空间ID'
```

核对批次后，通过 `scan` 返回的 `batchId` 和 `digest` 批准本次本地正文/图片校验：

```bash
npm run workbuddy:inbox -- approve --owner-id '本机账号ID' --space-id '空间ID' --batch-id '批次ID' --digest '清单SHA256' --yes
npm run workbuddy:inbox -- scan --owner-id '本机账号ID' --space-id '空间ID'
```

本机正式 API 启动后每 5 秒检查已配置的交换箱；未配置时不创建目录、不扫描磁盘，内存测试模式和非回环监听模式不启用。也可单独运行 `watch`；Ctrl+C 停止。更新代码后需重启本机服务才能启用新后台代码。Exchange 目录暂时不可用会在下一轮继续检查，不影响其他功能。

异常批次按随机 ID 移入交换箱的 `quarantine`，原文件保留；修复文件、清单和权限后，可运行 `retry --owner-id ... --space-id ... --batch-id ... --yes` 返回待确认状态，并重新批准。软链接/特殊文件本身不会被跟随或移动，仅标记失败。

授权绑定清单 SHA。清单变化撤销授权；文件属性变化触发重新校验。处理中断会在重启后重新校验，状态损坏会保留现场并停止。当前 F2 只会进入 `waiting → validating → ready/failed`；`processing/completed` 为 F3 归档保留。后续归档前必须再次校验 digest 和文件，不能仅凭旧的 ready 标记读取。

停用可重复运行 `configure`，使用相同目录、账号、空间并加 `--disabled --yes`；下一次扫描停止读取。新目录应作为独立绑定规划，当前不允许覆盖原绑定路径。状态文件包含 ID、计数、清单摘要和错误码，不包含聊天正文、联系人称呼和密钥。聊天目录不会进入普通 Git/发布包；已有浏览器和服务端备份功能不包含此交换箱。

适用范围：macOS、Node.js 22.12+、PostgreSQL 17、桌面浏览器。本流程只部署到当前电脑，不上传公网。

## WorkBuddy 必须遵守

1. 先检查，后变更。不得跳过预检直接初始化。
2. 缺少 Node.js 或 PostgreSQL 时，只向用户展示安装建议；未经明确同意不得运行 Homebrew 或其他系统安装命令。
3. 不读取、打印或上传 `.env.local`、`.local-data`、数据库连接、密钥、照片和备份。
4. 发现 `.local-data` 时视为已有用户资料，不得删除、移动或重新初始化。
5. `install` 和 `backup` 第一次只展示计划；得到用户确认后才添加 `--yes`。
6. 任何失败都保留原数据，先报告错误，再执行诊断；不要使用 `rm -rf`、`git reset --hard` 或删除 PostgreSQL 数据目录。

## 标准部署流程

从 GitHub Release 或其他来源下载时，应同时取得三个文件：`.tar.gz`、`.tar.gz.sha256` 和 `.manifest.json`。在解压前执行系统 SHA-256 校验：

```bash
shasum -a 256 -c quexin-local-macos-v0.1.0.tar.gz.sha256
```

校验失败时禁止解压或运行。解压后进入 `quexin-local` 目录，再核对包内清单、文件数量、权限和摘要：

```bash
node scripts/release-verify.mjs .
```

然后执行只读环境检查：

```bash
./WorkBuddy部署检查.command --json
```

- 如果 `errors > 0`：停止，不修改资料，并逐项向用户说明 `remediation`。
- 如果只有 warning：说明提醒内容。已有资料和当前鹊信正在运行属于可处理提醒，不是覆盖许可。

先展示安装计划：

```bash
node scripts/workbuddy-deploy.mjs install
```

用户确认后执行：

```bash
node scripts/workbuddy-deploy.mjs install --yes
```

成功标准：终端显示“WorkBuddy 本地部署完成”和健康检查地址，随后运行：

```bash
node scripts/workbuddy-deploy.mjs verify
```

将 `http://127.0.0.1:4188/` 提供给用户。重复执行 `install --yes` 必须保留已有账号、数据库、照片和密钥。

## 已实现命令

| 命令 | 作用 | 是否修改资料 |
| --- | --- | --- |
| `check` | 只读检查环境、端口、磁盘和旧数据 | 否 |
| `install` | 展示将执行的安装计划 | 否 |
| `install --yes` | 安装缺失的 npm 锁定依赖、初始化或保留数据库、启动并验证 | 是，需要确认 |
| `start` | 启动五个本地组件并验证数据库就绪 | 仅运行状态 |
| `status` | 查看组件 PID 和端口 | 否 |
| `doctor` | 只读检查迁移、角色、目录权限和磁盘 | 否 |
| `backup` | 展示备份计划 | 否 |
| `backup --yes` | 必要时停机，生成一致性备份，再恢复原运行状态 | 是，需要确认 |
| `restore --backup ... --yes` | 校验备份、恢复到新数据库并健康检查；原库保留 | 是，需要确认 |
| `verify` | 检查 API、数据库和组件状态 | 否 |
| `stop` | 停止启动器管理的组件，保留全部资料 | 仅运行状态 |
| `config status` | 查看模型/OCR/转写/邮件状态，只显示脱敏信息 | 否 |
| `config plan --input ...` | 验证并展示可选配置计划 | 否 |
| `config apply --input ... --yes` | 备份旧配置、写入 600 权限配置并安全重启验证 | 是，需要确认 |
| `upgrade --package ...` | 校验并展示升级计划 | 否 |
| `upgrade --package ... --yes` | 备份数据与旧程序、替换、迁移、健康检查；失败自动恢复 | 是，需要确认 |
| `rollback` / `rollback --yes` | 展示/执行程序回滚，默认不回退用户后续数据 | 执行时需要确认 |
| `uninstall` / `uninstall --yes` | 展示/执行程序移入废纸篓，保留 `.local-data` | 执行时需要确认 |
| `purge-data` | 彻底清理计划；必须完整确认语才会把数据移入废纸篓 | 是，二次确认 |

统一格式：

```bash
node scripts/workbuddy-deploy.mjs <check|install|start|status|doctor|backup|restore|stop|verify|config|upgrade|rollback|uninstall|purge-data> [参数]
```

## 可选模型、OCR、转写和 SMTP

这些能力不是本地版启动前置条件。默认状态为本地检索、人工文字/OCR 校正和本地 outbox，不连接任何外部服务。

安装完成后，使用者可以直接登录鹊信，在“系统 → 空间与功能 → 模型 API 接入口”配置 DeepSeek 或 OpenAI 兼容接口。页面要求当前账号密码，只通过回环本机 API 写入 `.env.local`，读取时不返回完整 Key，并由本地启动器自动重启。WorkBuddy 无需代替使用者查看或保存 Key。

发布包内含 `skills/qingniao-agent/`，遵循 `SKILL.md` 开放目录规范。WorkBuddy 可以读取该 Skill 了解十种 Agent 工作流和审批等级，但不得因此获得额外权限：外部日历/邮件仍需页面中的逐项确认，Skill 不包含 API Key。

青鸟产品界面采用统一聊天入口，不显示独立 Agent、来源或运行记录分页。WorkBuddy 部署后不需要替用户配置工作流；用户在聊天框输入目标，Skill 路由、资料范围和审批都由鹊信本机运行时处理。

普通聊天通过统一 `conversation` 操作调用模型，但不会自动携带本地回忆或计划；产品控制只允许发布包目录中的白名单工具。WorkBuddy 不得扩展工具 ID 或绕过页面原有的密码、删除、恢复和共享确认。

`wechat-chat-import` 仅登记为关闭的 capability gate。WorkBuddy 只有在存在真实聊天提取适配器、明确用户授权、保留来源与顺序、通过代表样本和失败回退验收后，才能提出启用；不得用微信演示界面、截图 OCR 或示例聊天冒充已接入。

需要配置时，复制模板并限制为当前用户可读：

```bash
cp config/workbuddy-options.example.json .workbuddy-options.local.json
chmod 600 .workbuddy-options.local.json
```

WorkBuddy 根据用户选择编辑该文件：`model.provider` 可设为 `deepseek` 或 `openai-compatible`；模型问答、模型辅助写作和图片 OCR 共用 `model.apiUrl/apiKey/model`；录音转写还需填写 `transcriptionModel`。DeepSeek 固定使用官方地址，且不配置录音转写。SMTP 需要 `mail.mode=smtp`、`smtpUrl` 和“名称 <邮箱>”格式的 `from`。

先验证并展示计划，输出不得出现 API Key 或 SMTP 密码：

```bash
node scripts/workbuddy-deploy.mjs config plan --input .workbuddy-options.local.json
```

用户确认后应用：

```bash
node scripts/workbuddy-deploy.mjs config apply --input .workbuddy-options.local.json --yes
node scripts/workbuddy-deploy.mjs config status --json
```

应用时会备份旧 `.env.local`，若鹊信正在运行则安全重启并检查五个组件。SMTP 连接失败或能力状态不一致会自动恢复旧配置和旧运行状态。配置完成后应删除包含明文密钥的 `.workbuddy-options.local.json`，或将其移到用户自己的密码管理位置。

若要恢复完全本地模式，将模板保持 `model.enabled=false`、`mail.mode=local` 后重新 apply。

## 升级与回滚

升级前，三个发布文件必须放在同一目录：新 `.tar.gz`、对应 `.tar.gz.sha256` 和 `.manifest.json`。

先展示计划：

```bash
node scripts/workbuddy-deploy.mjs upgrade --package /完整路径/新版本.tar.gz
```

用户确认后：

```bash
node scripts/workbuddy-deploy.mjs upgrade --package /完整路径/新版本.tar.gz --yes
```

流程固定为：验证新包 → 停机 → 服务端数据备份 → 旧程序快照 → 替换程序 → `npm ci` → 数据库迁移 → 五组件健康检查。任何步骤失败都会恢复旧程序；进入迁移后失败还会从升级前备份恢复并切换数据库。

最近一次成功升级可以执行程序回滚：

```bash
node scripts/workbuddy-deploy.mjs rollback
node scripts/workbuddy-deploy.mjs rollback --yes
```

回滚会先备份当前数据，但默认只回滚程序，不回退用户升级后新增的资料。

## 安全卸载

默认卸载保留所有用户数据：

```bash
node scripts/workbuddy-deploy.mjs uninstall
node scripts/workbuddy-deploy.mjs uninstall --yes
```

程序、`node_modules` 和可选 `.env.local` 会移入 macOS 废纸篓；`.env.local` 另在数据目录中保留一份 600 权限副本。项目原位置保留 `.local-data` 和数据说明文件，方便重新安装。

彻底清理必须是独立动作，并要求完整确认语；数据仍是移入废纸篓，而不是直接 `rm`：

```bash
node scripts/workbuddy-deploy.mjs purge-data --yes --confirmation "永久删除鹊信本地资料"
```

WorkBuddy 不得把 `uninstall --yes` 和 `purge-data` 合并执行，也不得替用户自动填写确认语。

## 数据位置

- 默认数据：项目目录下 `.local-data/`
- 配置和随机密钥：`.local-data/runtime/config.json`，权限 600
- 媒体：`.local-data/media/`
- 服务端备份：`.local-data/backups/`
- 浏览器私人资料：需要用户在“系统 → 数据与备份”单独导出 JSON

本地服务端备份不能替代浏览器 JSON，反之亦然。

## 当前阶段边界

- 已完成检查、安装、启动、状态、诊断、备份、验证和停止。
- 已完成发布压缩包、包内/包外 manifest、SHA-256、路径安全和篡改校验。
- 已完成可选模型/OCR/转写/SMTP 的本机配置、脱敏状态、旧配置备份、运行中重启和失败回滚。
- 已完成校验升级、升级前双备份、迁移失败恢复、程序回滚、保留数据卸载和确认后数据移入废纸篓。
