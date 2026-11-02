# 本地发布包 L4：首次使用与可选能力配置

日期：2026-11-01。L4 已完成。零外部密钥时，鹊信继续使用本地检索、人工 OCR/文字校正和本地 outbox；用户提供自己的服务配置时，WorkBuddy 可以脱敏计划、安全写入、重启验证并在失败时回滚。

## 已实现

- `config/workbuddy-options.example.json`：默认 `model.enabled=false`、`mail.mode=local`，不含真实密钥。
- `scripts/workbuddy-config.mjs`：`status/plan/apply`。
- `node scripts/workbuddy-deploy.mjs config ...` 统一入口。
- 模型问答、模型辅助写作和图片 OCR 共用 OpenAI 兼容的 `apiUrl/apiKey/model`；录音转写额外使用 `transcriptionModel`。
- 模型 API 仅允许 HTTPS，或明确的本机回环 HTTP；SMTP 仅允许 `smtp:`/`smtps:`。
- 未知字段、示例密钥、非本机 HTTP、控制字符/换行注入和格式错误在写文件前被拒绝。
- 配置输入文件必须为普通文件且权限为 600；也可从标准输入 `--input -` 读取，避免留下额外明文文件。
- `.env.local` 原子写入、权限 600；只替换 WorkBuddy 管理的键，保留其他用户配置并清除重复旧键。
- 公开状态只显示是否启用、脱敏服务地址、模型名和发件人，不显示 API Key、SMTP 用户名/密码。
- 应用新配置前备份旧 `.env.local` 到 700 目录、600 文件。
- 运行中配置会安全停止并重启五组件；健康检查验证模型/OCR/转写状态和组件持续运行。
- SMTP 连接失败或能力状态不一致时自动恢复旧配置并重新启动旧服务。
- `/health` 新增无敏感信息的 `assistant/ocr/transcription` 布尔能力状态。

## 验收结果

| 场景 | 结果 |
| --- | --- |
| 零密钥模板 | 本地检索、人工文字、本地 outbox 正常 |
| 合法模型/OCR/转写配置 | 状态启用，五组件重启后 health 一致 |
| 状态与计划输出 | 不包含模型 Key 或 SMTP 密码 |
| `.env.local` 与历史备份 | 600 权限，备份目录 700 |
| 非本机 HTTP、示例值、未知字段、换行注入 | 写入前拒绝，原配置不变 |
| 合法格式但无法连接的 SMTP | 启动失败，自动恢复旧配置和旧运行状态 |
| 关闭回完全本地模式 | assistant/ocr/transcription 全部回到 false |
| 配置规则测试 | 4/4 通过 |
| 隔离重启/回滚测试 | 1/1 通过 |
| 发布包和构建 | 通过 |

当前正式本地实例已安全重启，五组件运行，健康状态为 `ready`；未配置外部模型，能力状态正确为 `assistant=false / ocr=false / transcription=false`，邮件保持 local。

## 更新后的发布包

- 当前文件数：125
- 当前解压文件总字节：10,922,706
- 当前 SHA-256：`2d74e00806fb549122cf279777ab9ef86159f701ea90810fd76ead3ed031d8f1`

## 下一阶段

L5 实现升级、程序回滚和安全卸载：升级前强制备份，验证新包后才切换；失败保留旧程序与数据库；默认卸载程序但保留用户数据。
