# 鹊信 · 本地网页版

以回忆、日程、关怀、信件和一起照顾的小鹊为核心的本地网页。十套主题参考用户提供的 UI 与宠物设计；手机使用独立的五项底栏和记录入口。

本地五阶段收尾计划已完成验收。**这指本地可演示版本，不代表所有外部服务和生产部署已经完成。**

现已按 [完整产品八阶段计划](reports/product-completion-plan.md) 完成本地范围开发与验收；P7 实体手机/读屏仍待验收，P3/P4 和 SMTP 的真实外部端点仍未配置。P8 已补齐五组件运行、通知租约、任务告警、最小数据库权限、配置医生和恢复演练，见 [P8 运行与交付加固](reports/product-p8-operations-delivery-qa.md) 与 [最终能力矩阵](reports/product-capability-matrix.md)。

## 直接体验

当前电脑已配置好，双击 **启动鹊信.command**，或在项目目录运行：

```bash
npm run local:start
```

统一地址：**http://127.0.0.1:4188/**。停止使用 `npm run local:stop`，检查状态使用 `npm run local:status`。启动器只管理自己启动的进程，端口冲突时提示，不结束其他程序。

当前配置沿用原本机 PostgreSQL 数据库和媒体目录，保留浏览器地址与资料。详细操作见 **[本地使用说明](本地使用说明.md)**。

## 新环境安装

需要 Node.js 22.12+ 和 PostgreSQL 17：

```bash
npm ci
npm run local:init
npm run local:start
```

默认在 `.local-data/postgres/` 创建项目独立数据库，完成迁移并生成受限应用账号；不会清空已有系统数据库。配置存在时不重新初始化。macOS 可双击“初始化鹊信.command”。

`dev:full` 和 `dev:formal-full` 已统一为上述启动器的兼容入口。单独开发前端仍可使用 `npm run dev`，但不要与已启动的 4188 服务同时运行。

## 体验流程

首次打开创建空白空间，也可主动选择“先用虚构资料体验完整功能”。示例不会连接真实微信或模型。

| 入口 | 已实现的流程 |
| --- | --- |
| 今日 | 待确认候选、最近安排、回忆入口、宠物预览 |
| 记录 | 手机统一新建回忆、整理聊天/照片、添加计划、写信、表达需要 |
| 青鸟「＋」与资料核对 | 添加 TXT/JSON/CSV/HTML、图片或录音，粘贴文字、人物映射、范围选择、候选编辑/确认/忽略；没有模型也可本机核对 |
| 回忆 | 搜索、照片墙/时间线、编辑、来源追溯、删除、导出 |
| 计划 | 日历、IANA 时区、日/周/月/年重复、实例完成、页内/浏览器提醒、完成后存成回忆 |
| 关怀 | 双账号需要分享/更新/撤回/过期、私人草稿、周期日期和关怀日程 |
| 鹊巢 | 四种宠物姿态、摸摸/喂食/休息/唤醒/梳羽/送信/探索、布置、改名、心愿旅程，以及可点回共同回忆的成长来源 |
| 创作 | 信件、日常、服务端加密时光胶囊、按已确认回忆生成年度回顾、逐次确认资料的模型草稿、离线纪念馆 |
| 系统 | 十套主题、个人资料、账号、双人同步、私有媒体、备份、数据包与删除流程 |
| 青鸟 | 仅引用已确认非私密记录的本地检索，回答可打开来源；删除记录后引用更新 |

十套主题：素笺朱砂、墨白留声、明快日常、竹影听风、星河来信、碧玉流光、暖阳花序、松墨鎏金、胶片手账、山海织锦。角色延续金棕冠羽、蓝灰羽毛和脚上红绳；采用四种平面动作素材与 CSS 动效。

## 账号与双人空间

在“系统 → 空间与功能”注册/验证、创建空间并生成邀请码，另一人在独立浏览器会话登录后加入。邮件验证/重置链接可直接打开；本机开发邮件箱供演示使用，不发送真实邮件。

正式账号使用独立浏览器资料库；未登录空间保留在原资料库。已确认且非私密的记录和可共享日程可同步。共同资料及小鹊名字、房间和互动由双方共享；个人主题、私人草稿和周期日期保持个人范围。

离线共同宠物操作在重新打开页面/恢复连接后重试。普通资料同步支持前台重试和受浏览器能力限制的 Service Worker；不承诺真实手机关闭应用后的自动调度。

## 资料核对、检索与来源

来源保留批次、文件或文本名称、整理文本行号、人物映射前后的文字及时间。编辑回忆正文不会覆盖导入依据。日期不明确与隐私提示分别处理；私人候选需单独确认，不自动生成共享日程。

候选和青鸟默认使用本地规则/检索。导入支持 TXT、JSON、CSV、HTML、图片 OCR 与录音转写；识别结果必须人工校正。服务端已支持 DeepSeek 与 OpenAI 兼容 Responses API、图片输入、文件转写、逐次资料确认、取消和失败回退；可在“系统 → 空间与功能 → 模型 API 接入口”输入自己的 API Key，保存时要求当前账号密码并自动安全重启。密钥只写入本机 600 权限的 `.env.local`，读取接口不会回传。未配置时不会发起外部请求。**当前本机仍未配置实际模型密钥，微信也未直连。** 来源是用户核对后的整理文本，不是原始文件字节级存证。

### 青鸟 Agent 与 Skill

接入模型并开启逐次资料发送同意后，青鸟就是一个统一聊天式个人智能体，不再提供“为你整理 / Agent / 来源 / 记录”分页或工作流模式按钮。用户只在一个输入框里说“记住……”“提醒我……”“每周……”“回顾一下……”“处理这张图”“帮我写……”，青鸟自动判断意图并选择十个内置 Skill。资料范围、动作草稿、修改、批准、拒绝、工具结果和引用都显示在同一条聊天流中；不会自动发送邮件或直接改写第三方日历。会话、审批、来源 ID、步骤和结果保存在当前账号的浏览器资料库，并随 JSON 备份恢复。

普通问候、能力询问和一般讨论不再要求本地资料，可使用最近有限轮次对话直接回答；涉及“我们第一次、回忆、计划、纪念日”等个人事实时仍只依据本地可引用资料，没有来源就明确不知道。青鸟还可调用十个白名单产品工具，打开任意主页面、照顾小鹊、切换个人主题/模块、导出备份或纪念馆。删除账号/空间、恢复备份、修改密码/API Key 等高风险功能只打开原确认页面，不绕过密码。

微信聊天提取是能力门禁，不是默认 Skill。当前没有经过来源、权限和失败回退验收的 WorkBuddy 聊天提取适配器，因此不会注册或伪装微信 Skill；将来适配器通过验证后再启用。

WorkBuddy 文件夹交接已完成 F1–F5：登录后对青鸟说“检查 WorkBuddy 新聊天”，即可连接专用目录、确认批次、建立本机私人归档、检索聊天、选择片段整理并逐条保存。向 DeepSeek 等外部服务发送片段需要单次确认。未确认结果不写入浏览器资料库；保存的候选默认私密。该流程读取 WorkBuddy 导出的文件，不控制 WorkBuddy 或微信。见 [操作说明](DEPLOY_WITH_WORKBUDDY.md) 和 [F4 验收记录](reports/product-p13-f4-chat-qa.md)。


桌面一级导航已移除“导入”。统一从青鸟「＋」添加附件、粘贴文字或查看全部待确认候选，首页“核对全部”也可直接进入。旧 `#import` 链接、导入草稿和历史 Agent 的 `import` 目标仍然有效，页面显示为“资料核对”。附件可以只在本机核对；交给模型处理前必须单独勾选本次发送确认，识别失败后保留附件供手动处理。详见 [F5 验收记录](reports/product-p13-f5-entrypoints-qa.md)。

Skill 包位于 `skills/qingniao-agent/`，采用 GitHub 上 [Agent Skills 开放规范](https://github.com/agentskills/agentskills/blob/main/docs/specification.mdx)；人工审批和可恢复执行借鉴 [LangGraph human-in-the-loop](https://github.com/langchain-ai/langgraphjs/blob/main/docs/docs/agents/human-in-the-loop.md)，项目没有新增 LangGraph 运行依赖。

## 保存、备份与恢复

浏览器资料库保存回忆、日程、文字、私人内容和设置，刷新后保留。连续写入按队列执行，并校验其他标签页冲突。请等待保存完成后关闭页面；清除网站数据仍会删除浏览器资料。

- 浏览器备份：系统 → 数据与备份 → 导出完整备份。恢复前验证结构并要求确认，包含私人内容。
- 服务端备份：停止服务后运行 `npm run local:backup`，包含 PostgreSQL、媒体、导出文件、通知密钥和胶囊解密密钥。
- 服务端恢复：`npm run local:restore -- "/完整路径/备份目录"`。校验后恢复到新数据库，成功才切换配置，原数据库保留。
- 浏览器 JSON 和服务端备份不能互相替代。受保护图片仍需要服务端副本。
- 离线纪念馆为独立 HTML，不含私人草稿/周期信息或未到期胶囊正文。

完整路径、恢复步骤与故障处理见 [本地使用说明](本地使用说明.md)。

## 手机与 PWA

```bash
npm run build
npm run preview:mobile
```

同一 Wi-Fi 手机打开终端的 Network 地址。此命令为单人前端预览，禁用正式 API 代理；手机数据独立保存在手机浏览器。本机正式账号与双人服务入口仍是电脑上的 4188。

生产构建包含 PWA、图标和 Service Worker。受支持的浏览器和安全上下文中，完成首次缓存后可离线使用已缓存界面；手机局域网 HTTP 不注册 Service Worker。默认预缓存约 10 MiB 图片与资源。真实 iPhone/安卓、Safari/Firefox 和系统后台行为尚未验收。

## 验收与开发

```bash
npm run test:full
npm run test:full -- --postgres
npm run test:local-runtime
npm run test:fresh-install
npm run test:a11y
npm run test:compat
npm run test:performance
npm run local:doctor
npm run production:doctor
```

完整回归使用独立内存 API 或临时 PostgreSQL，不清空业务库。单项命令保留：`test:account`、`test:couple`、`test:import`、`test:creation`、`test:capsule-store`、`test:visual`、`test:release`、`test:e2e`、`test:api`、`test:pwa`。直接运行 PostgreSQL API 测试须显式提供隔离库 `API_TEST_DATABASE_URL`。

| 阶段 | 证据 |
| --- | --- |
| 账号流程 | [第一阶段](reports/account-flow-qa.md) |
| 双人空间与鹊巢 | [第二阶段](reports/couple-workspace-qa.md) |
| 导入与青鸟 | [第三阶段](reports/import-assistant-qa.md) |
| 视觉与交互 | [第四阶段及截图](reports/visual-interaction-qa.md) |
| 本地交付 | [第五阶段](reports/local-delivery-qa.md) |
| 总计划 | [五阶段进度](reports/local-release-plan.md) |
| 完整产品 P6 | [鹊巢成长与安全胶囊](reports/product-p6-nest-creation-qa.md) |
| 完整产品 P7 | [跨端、无障碍与性能](reports/product-p7-cross-device-performance-qa.md) |
| 完整产品 P8 | [运行与交付加固](reports/product-p8-operations-delivery-qa.md) |
| 最终状态 | [能力与待验收矩阵](reports/product-capability-matrix.md) |

前端代码在 `src/`，共享宠物规则在 `shared/`，API/迁移在 `server/`，运行器在 `scripts/local-runtime.mjs`。服务端技术边界见 [开发说明](server/PRODUCTION.md)。

## 尚未接入或验收

真实模型/OCR、微信直连、真实 SMTP 收件箱投递、操作系统提醒、实体手机后台调度及公网生产部署不属于已完成的本地能力。默认启动器会运行本机维护和本地通知投递器，但不会在未配置时连接 SMTP；真实 SMTP 可通过 `production:doctor -- --external` 先做连接/认证验证，不发送邮件。

浏览器按账号分区不等于磁盘加密。安全时光胶囊正文使用服务端 AES-256-GCM 静态加密，未到期接口不返回正文或密文，但它不是端到端加密；服务器密钥丢失后正文无法恢复。尚未发出的旧队列按当前范围过滤；已发出的记录、媒体可以撤回，并使旧服务端数据包链接失效。对方已经下载、截图或另存的副本无法远程抹除。生产对象存储、多实例限流、监控告警和异地灾备仍需另行实施。历史阶段报告只代表各自当时的范围，以本说明及完整产品计划为准。
