# 使用 WorkBuddy 部署鹊信本地版

Windows 用户请先阅读 [Windows + WSL2 预览部署说明](DEPLOY_WINDOWS_WSL.md)，不要直接执行 macOS 的 `.command` 入口。

## WorkBuddy 文件夹交接（F1–F6 已完成）

当前已具备转换器、安全收件箱、聊天归档、本地检索，以及青鸟聊天内的范围确认、候选整理和原文追溯。`ready` 表示文件校验通过；`completed` 表示本地聊天归档事务完成。归档内容尚未成为正式回忆，也不会自动共享给伴侣。

WorkBuddy 和鹊信在同一电脑上交接文件。“交换箱”不等于双方可见的共享聊天库。原始聊天放在源码目录以外，鹊信只访问明确配置的目录。当前不会遥控 WorkBuddy，也不会扫描微信。网页访问从登录会话取得账号，由服务端查询当前空间；没有双人空间时使用账号独立的 `personal` 归档。浏览器不能传入其他账号或空间获得权限。

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

核对批次后，通过 `scan` 返回的 `batchId` 和 `digest` 批准本次本地正文/图片校验。若同时允许建立本地聊天归档，加上 `--archive`；省略该参数则维持 F2 的仅校验行为：

```bash
npm run workbuddy:inbox -- approve --owner-id '本机账号ID' --space-id '空间ID' --batch-id '批次ID' --digest '清单SHA256' --archive --yes
npm run workbuddy:inbox -- scan --owner-id '本机账号ID' --space-id '空间ID'
```

本机正式 API 启动后每 5 秒检查已配置的交换箱；未配置时不创建目录、不扫描磁盘，内存测试模式和非回环监听模式不启用。也可单独运行 `watch`；Ctrl+C 停止。更新代码后需重启本机服务才能启用新后台代码。Exchange 目录暂时不可用会在下一轮继续检查，不影响其他功能。

异常批次按随机 ID 移入交换箱的 `quarantine`，原文件保留；修复文件、清单和权限后，可运行 `retry --owner-id ... --space-id ... --batch-id ... --yes` 返回待确认状态，并重新批准。软链接/特殊文件本身不会被跟随或移动，仅标记失败。

授权绑定清单 SHA。清单变化撤销授权；文件属性变化触发重新校验。批准归档后的流程为 `waiting → validating → ready → processing → completed`。归档会再次核对文件，在单个数据库事务中写入；同一批次重复运行复用已提交结果，重启不会重复写入。进程意外退出自动恢复；用户主动取消后暂停归档，需重新批准。已经提交完成的事务不会因稍晚的取消回滚。

停用可重复运行 `configure`，使用相同目录、账号、空间并加 `--disabled --yes`；下一次扫描停止读取。新目录应作为独立绑定规划，当前不允许覆盖原绑定路径。状态文件包含 ID、计数、联系人称呼、日期范围、清单摘要和错误码，用于显示读取确认卡；不包含聊天正文和密钥。聊天目录不会进入普通 Git/发布包；已有浏览器和服务端备份功能不包含此交换箱。

### 日常使用：直接在青鸟聊天中操作

1. 在鹊信登录本机账号，向青鸟输入 **“检查 WorkBuddy 新聊天”**。
2. 首次使用填写专用交换箱完整路径和当前账号密码，点击“授权连接这个文件夹”。不会扫描其他目录；已有目录须符合 0700/0600 的私有权限要求。
3. 展开“给 WorkBuddy 的交接信息”，将当前空间标识交给 WorkBuddy。按本项目的文件夹任务模板导出到该空间的 `ready/`。先前 CLI 用占位账号/空间生成的批次不能冒充当前登录账号；需要按新的真实空间标识重新生成交接批次。
4. 青鸟显示联系人、日期范围、消息/图片数量。勾选确认后点击“确认读取并归档”。大批次显示处理数量，可停止；已提交的归档会保留。
5. 输入 **“搜索聊天记录：海边”**，或使用聊天卡中的关键词、日期、发送者筛选。每页最多 20 条，可查看单条完整原文。
6. 选中最多 6 条（若模型配置的来源上限更低，则采用更低上限），点击“整理所选片段”。每条发送文字最多 1,000 字，不发送图片、其他聊天或通用聊天历史。
7. 可以“只在本机整理”，也可以在完整片段预览中逐次确认发送给已配置的 DeepSeek / 兼容模型。发送确认只用一次、5 分钟有效，登录会话或模型配置变化后重新确认。
8. 逐条编辑并核对候选后，“确认保存为私人记录”。回忆和计划类需要填写日期；计划候选仅保存为记录，不会自行新增日程。正式日程仍通过青鸟的计划审批流程创建。

未确认的聊天结果、预览和候选只放在当前页面内存，收起、新对话、关闭或刷新即清除，不进入 IndexedDB、普通备份、同步队列或通用模型对话历史。明确保存的一条候选及引用节选进入当前账号浏览器资料库，可随私人 JSON 备份带走；原始聊天库仍留在本机服务的独立归档中。已保存记录的来源区可以再次查询本机完整原文；换电脑或移除归档后只保留已保存节选。

校验失败的批次显示原因。修复隔离目录中的文件后点击“文件修复后重新检查”，随后必须重新勾选范围确认；修复文件不会自动批准正文读取。界面与接口均不提供原始聊天编辑或删除。

F1–F6 已完成。真实样本只在临时隔离目录验收，当前日常使用账号的交换箱未自动启用；WorkBuddy 提取和鹊信读取仍须由用户按各自范围发起。

### 导出图片损坏时：重新取得原图，再生成新批次

严格校验会拒绝损坏图片并保留隔离批次；不要跳过校验或将坏图重编码冒充原图。先让 WorkBuddy 从同一已授权来源重新取得原图，保存在独立目录，保持 `images/文件名` 与原引用一致。

转换时显式指定补导目录：

```bash
node scripts/workbuddy-chat-bridge.mjs convert \
  --source '/原始导出目录' \
  --media-overrides '/补导原图目录' \
  --inbox '/鹊信交换箱目录' \
  --space-id '从青鸟交接信息取得的空间标识' \
  --conversation-id 'couple-chat'
```

只有原聊天声明的相对图片路径会被查找；补导目录中有同名文件时采用该原图，否则继续读取原导出。拒绝链接和项目内目录，不覆盖任何源文件。输出中的 `mediaOverridesUsed` 显示采用的补导数量；消费者仍逐项验证完整解码和 SHA。请生成新批次 ID，不要把旧批次清单直接改成另一个内容。

### 没有 WorkBuddy 或模型时：青鸟「＋」手动核对

“导入”已从一级导航移除。打开青鸟后点击输入框旁的「＋」，可以选择文件、粘贴文字、查看全部待确认候选，或检查 WorkBuddy 交换箱。首页“青鸟资料”卡片提供同样入口。

选择 TXT、JSON、CSV、HTML、图片或录音后，点击“只在本机核对这个附件”，文件会交给内部“资料核对”页。未启用模型时直接点击发送，也会进入本机核对。文字文件可直接解析；图片和录音可手动填写整理文字。使用 OCR/转写时仍需点击对应的发送确认按钮。

有模型时，可在青鸟内勾选仅本次附件发送同意，再发送给 Agent。识别或 Agent 处理失败会保留附件，可改走本机核对。已有未完成草稿时，新附件必须先选择“使用新附件”或“保留原草稿”；解析错误不会替换旧文字。

候选可通过青鸟「＋ → 查看待确认候选」、输入“打开资料核对”，或首页“核对全部”进入，包括需要单独确认的敏感候选。旧 `#import` 网址和历史 `open-page/import` 任务保留兼容；不要修改旧备份里的页面 ID 或来源字段。

### 归档位置与查询

归档位于本机数据目录的 `workbuddy-archive/<账号空间绑定摘要>/chat.sqlite`，目录 `0700`、数据库文件 `0600`。它与浏览器 IndexedDB、同步用 PostgreSQL 分开保存；现有普通浏览器/服务端备份不包含该归档，原始导出和交换箱仍需用户单独妥善保留。文件权限限制访问，但不等于数据库内容加密。

采用 Node.js 内置 SQLite 并在 Worker 中处理写入和查询，无需增加数据库软件。当前在 Node 22.22.3 验证；Worker 显式使用 `--experimental-sqlite` 以兼容项目的 Node 22.12 起配。SQLite 在 Node 22 中仍属于实验性接口，更新 Node 后需重跑归档测试。官方说明：https://nodejs.org/download/release/v22.23.0/docs/api/sqlite.html 。

```bash
npm run workbuddy:inbox -- archive-stats --owner-id '本机账号ID' --space-id '空间ID'
npm run workbuddy:inbox -- search --owner-id '本机账号ID' --space-id '空间ID' --conversation-id '稳定会话ID' --query '海边' --from '2026-01-01' --to '2026-12-31' --limit 30
npm run workbuddy:inbox -- message --owner-id '本机账号ID' --space-id '空间ID' --conversation-id '稳定会话ID' --message-id '检索返回的消息ID'
```

`search` 返回最多 100 条、每条最多 500 字符的相关片段；使用 `--sender-id` 筛选发送者，使用返回的 `nextCursor` 继续翻页，翻页时需保持其他筛选条件一致。分页固定当前快照，新投递和迟到消息在下次新查询中出现。`message` 返回选定原文及来源位置（来源类型 `workbuddy-chat`、批次、原消息 ID、分块、行号、清单 SHA、提取器版本）。这两个显式查询命令会向当前终端显示私密内容，请勿将其输出并入公开日志。

媒体在数据库中仅保存相对路径与 SHA，不复制图片字节；原批次图片被移走时，图片引用可能不可用。归档按账号/空间分开存储，F4 网页接口已根据认证会话限定访问；客户端账号字段仅作防止切号竞态的比对，不能用于授权。

原始消息 ID 优先使用；没有 ID 时，转换器按会话、发送者、时间、规范化正文、媒体哈希和相同消息出现次数生成回退 ID，避免批次切分和序号变化导致重复。`fallbackIdentities` 返回本次使用回退身份的数量。无原始 ID 时，跨批次完全同一时间、同一发送者、同一正文的真实重复仍有歧义，应保留完整原始导出用于复核；每次投递的来源位置均保存。重复消息不推进新增计数；迟到消息照常入库，水位只记录已见最晚时间，不作为跳过历史消息的依据。缺失时间会要求补齐，不再捏造为当天中午。

同一原始 ID 的正文冲突、同一批次 ID 换内容会拒绝整批写入。当前每个账号/空间限制 100 万条归档消息、200 万条来源关系，正文与引用的保守空间预算 512 MiB；上限错误会停止该批次。读取接口不提供编辑或删除原始聊天的功能。归档数据库及收件箱状态目录已加入 Git、发布包和本地网页直链访问的排除规则。

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
