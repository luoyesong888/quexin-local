# P13 F2 安全收件箱验收

日期：2026-11-03。范围为文件夹交接后台，不包含 F3 聊天归档或 F4 青鸟 UI。

## 交付

- `shared/workbuddy-chat-files.mjs`：目录/文件边界、安全限量读取、私有状态原子写入。
- `server/lib/workbuddy-inbox-validator.mjs`：清单、文件集、SHA、大小、消息、图片实际格式/解码校验。
- `server/lib/workbuddy-inbox.mjs`：绑定、清单发现、明确批准、状态、互斥锁、隔离和重试。
- `server/lib/workbuddy-inbox-monitor.mjs`：可选后台轮询；核心服务与交换箱故障隔离。
- `scripts/workbuddy-inbox.mjs`：本机 CLI；配置和批准都有显式参数，未批准不读取正文。
- 正式 API 的回环本机模式加载监视器；无绑定或停用时不读取交换箱。

## 检查边界

- 所有自动化用例使用 `/private/tmp` 中的合成聊天和生成图片，测试后清理测试目录。
- 本轮未读取/复制真实聊天正文，未改动真实导出目录，未配置真实交换箱。
- 自动扫描仅打开 manifest。批次正文、图片须以清单 SHA 明确批准。
- 失效批次原文件保留在 quarantine。状态文件不记录正文、联系人标签或密钥。
- 目录权限不足时拒绝处理，不自动 chmod 用户现有目录。
- F2 的 ready 不等于导入完成；没有伪造归档完成状态。

## 测试覆盖

- 未批准不读正文，staging 半成品忽略，批准后多分块完整校验。
- 缺失/损坏/超限清单、版本不符、总数不符、错误空间、越界路径、额外字段与文件。
- 内容哈希、文件大小、损坏图片、伪装 MIME、错误消息顺序和媒体引用。
- 路径祖先及图片软链接、硬链接、宽权限、项目内输出拒绝。
- 清单变化撤销授权，已通过文件篡改重验，隔离修复和重新批准。
- validating/processing 中断恢复、死进程锁恢复、并发互斥、取消和状态损坏保护。
- watcher 自动发现、不可访问后恢复、停用；无配置不生成状态目录。
- CLI 明确批准、账号状态分离、对象原型同名批次 ID。
- F1 转换器、青鸟 Skill 包、运行配置、发布包边界与构建兼容性。

## 运行方式

`node --test tests/workbuddy-inbox.test.mjs tests/workbuddy-chat-contract.test.mjs tests/qingniao-skill-package.test.mjs tests/release-bundle.test.mjs tests/runtime-config.test.mjs`

`npm run build`

结果：30 项相关测试通过（F2 专项 22 项、F1 协议 3 项、Skill 包 1 项、发布包 1 项、运行配置 3 项）；生产构建通过，保留既有单个脚本大于 500 kB 的体积提示。未宣称执行全项目完整回归。

详细配置和使用命令见 `DEPLOY_WITH_WORKBUDDY.md` 的“文件夹交接（F2 开发阶段）”。F3 消费前需再次校验清单和文件，避免使用过期 ready 状态。F4 网页账号隔离与范围卡尚待实现。
