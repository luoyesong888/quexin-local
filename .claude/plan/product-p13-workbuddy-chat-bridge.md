# P13 青鸟 × WorkBuddy 聊天记录桥接方案

> 状态：已被“仅文件夹交接版”取代，不执行  
> 后续以 `product-p13-workbuddy-chat-bridge-1.md` 为唯一实施计划。  
> 日期：2026-11-03  
> 目标：移除鹊信一级「导入」导航，由青鸟统一发起 WorkBuddy 聊天提取、本地文件交接、校验、候选整理与用户确认。

## 1. 结论

这个方向可以实现，但要分为两个能力层级：

1. **已验证：文件夹交接可行**  
   本机 WorkBuddy V5.9.3 已经实际完成过一次聊天提取，并在本地生成总览 JSON、分批 JSON、图片目录和 manifest。实际样本包含 8,952 条消息、80 天、9 个分批文件和 264 个图片引用。因此“WorkBuddy 提取 → 安全收件箱 → 鹊信读取”已有真实证据。
2. **尚需开发：青鸟直接调用 WorkBuddy**  
   当前已验证的是用户在 WorkBuddy 中发起任务，不是鹊信程序化调用 WorkBuddy。完全自动化需要 WorkBuddy 第三方应用/Open API 授权，或可调用的 Connector/CLI 适配器。

## 2. 现场证据与当前缺口

### 2.1 已有样本结构

```text
WorkBuddy/聊天记录/<会话导出>/
  _manifest.json
  chat.json
  <9 个分批 JSON>
  images/<264 张图片>
```

已有字段：

- `_manifest.json`：`total`、`batches[]`；批次条目含 `file/count/from/to`。
- 分批 JSON：根对象为 `messages[]`，每条含 `sender/time/text`。
- `chat.json`：`partner/self/total/days/range/chats[]`，每日含 `date/messages[]`。

### 2.2 正式适配必须补齐

当前目录权限为 `0755`，文件为 `0644`，不适合长期保存私密聊天。当前 manifest 也缺少：

- 格式名与协议版本。
- `jobId/batchId/conversationId`。
- 原始消息 ID、时区和稳定顺序号。
- 提取器版本和来源应用版本。
- 文件与媒体 SHA-256。
- 原子完成标记、失败状态和重试信息。

## 3. 产品体验

### 3.1 统一入口

桌面和手机不再显示一级「导入」导航。用户直接对青鸟说：

> “帮我提取和对方近三个月的聊天，包含图片。”

青鸟在对话中依次展示：

1. **L4 高敏授权卡**：联系人、日期范围、消息类型、是否包含图片、保存位置、谁可见。
2. **WorkBuddy 运行状态**：等待授权、提取中、写入中、校验中、已完成或真实失败。
3. **收件箱校验结果**：批次数、消息数、媒体数、重复数、异常文件。
4. **候选整理卡**：回忆、心愿、偏好、计划，依然逐条确认。

### 3.2 导入页的处理

- 从一级导航移除「导入」。
- **不立即删除 ImportPage 和导入引擎**，将其降级为青鸟可打开的「资料核对」内部页或抽屉。
- 手动 JSON/TXT/图片/录音保留在青鸟底部「+」附件入口，作为 WorkBuddy 不可用时的降级方案。
- 待确认数量迁移到「今日」卡片、青鸟标题或对话消息。

## 4. 推荐技术架构

```text
用户指令
  → 青鸟授权卡
  → WorkBuddy 任务桥接
  → WorkBuddy 提取器
  → 鹊信安全收件箱
  → manifest/SHA/顺序/数量校验
  → 原始聊天只读归档
  → 候选整理
  → 用户确认
  → 回忆/偏好/心愿/计划
```

### 4.1 WorkBuddy 调用层

推荐分两阶段：

- **第一阶段（可马上做）**：青鸟生成精确任务和授权范围，打开/引导用户在 WorkBuddy 执行；WorkBuddy 把产物写入安全收件箱；鹊信自动检测。
- **第二阶段（完全自动）**：把鹊信登记为 WorkBuddy 第三方应用，通过 OAuth2.1 获得用户授权，使用本地助理 API 发送提取任务并查询状态。

WorkBuddy 官方同时支持 MCP + Skill 和 CLI + Skill Connector。鹊信已有本机 HTTP API，若需 WorkBuddy 反向调用鹊信，优先选择 MCP + Skill；若提取器已固化为命令行，则使用 CLI + Skill。

### 4.2 安全收件箱

收件箱路径由本机管理配置保存，不写死用户名。推荐默认：

```text
~/WorkBuddy/鹊信交换箱/<spaceId>/
  requests/<jobId>.json
  staging/<jobId>/
  ready/<batchId>/
    manifest.json
    messages-0001.json
    media/
  processed/<batchId>.json
  quarantine/<batchId>/
```

规则：

- 目录 `0700`，文件 `0600`。
- WorkBuddy 先写 `staging`，完成后计算 SHA-256，最后原子移入 `ready`。
- 鹊信只读 `ready`，禁止浏览器读任意磁盘目录。
- 拒绝符号链接、路径穿越、超限文件、未知 MIME、错误校验值和未完成批次。
- 原始聊天不写入 `public/`、Git、发布包、浏览器完整备份和普通日志。

### 4.3 标准协议

`manifest.json` 至少需要：

```json
{
  "format": "quexin-workbuddy-chat-v1",
  "jobId": "...",
  "batchId": "...",
  "conversationId": "...",
  "sourceApp": "wechat",
  "extractorVersion": "...",
  "createdAt": "...",
  "timezone": "Asia/Shanghai",
  "participants": [],
  "range": {"from": "...", "to": "..."},
  "totals": {"messages": 0, "media": 0},
  "chunks": [{"file": "messages-0001.json", "count": 0, "sha256": "..."}],
  "media": [{"path": "media/...", "mime": "image/jpeg", "size": 0, "sha256": "..."}]
}
```

每条消息必须保留：

- `messageId`（或可重现的稳定哈希）。
- `senderId/senderLabel`。
- 原始时间、时区和顺序号。
- 文本和媒体引用。
- 来源批次、提取器版本。

幂等键使用 `conversationId + messageId`；暂无原始 ID 时，使用规范化发送者、时间、文本和媒体哈希组合生成。

## 5. 数据与权限

聊天历史按 **L4 高敏数据** 处理：

- 提取前明确展示联系人、日期、类型、媒体、存储目录和可见人。
- 原始聊天默认只属于发起者，不默认同步到双人空间。
- 共享之前另外确认；推荐需双方各自确认。
- 原文不会自动成为“已确认回忆”。
- 外部模型只能收到用户每次确认的少量片段，不传送整份聊天库。
- 不持续监控微信，不静默扫描，不修改微信数据库。
- 提取失败必须展示真实失败，不允许模型伪造完成。

## 6. 实施阶段

### P13.0 WorkBuddy 调用验证（0.5–1 天）

- 登记 WorkBuddy 第三方应用，确认 OAuth2.1 和本地助理 API 调用条件。
- 或固化一个 WorkBuddy Skill + CLI 提取器，完成 `status/export` 命令和结构化错误。
- 定义 `verified-workbuddy-chat-extractor` 健康检查。
- 门禁通过前不启用 `wechat-chat-import`，不移除导航。

### P13.1 安全收件箱与协议（1–2 天）

- 增加收件箱 watcher 和安全路径校验。
- 定义 manifest/chunk/media/ready 协议。
- 实现 SHA-256、幂等、配额、重启恢复和失败隔离。
- 增加 `workbuddy-chat` 来源类型和只读原文归档。

### P13.2 青鸟聊天工作流（2–3 天）

- 启用 L4 `wechat-chat-import` Skill，但只在健康检查通过时注册。
- 新增范围授权卡、进度、取消、失败恢复和批次摘要。
- 有正式调用时直接发起 WorkBuddy 任务；否则使用“打开 WorkBuddy + 预填任务”降级模式。
- 产物进入收件箱后自动发现，但候选仍需用户确认。

### P13.3 隐藏导入导航（1–2 天）

- 从桌面导航移除「导入」。
- 保留内部核对路由和附件降级入口。
- 更新 `open-page` 工具白名单、首页候选入口和导航测试。
- 用户只能从青鸟或「今日」待确认卡进入资料核对。

### P13.4 真实端到端验收（1–2 天）

- 授权的小样本、完整样本和增量样本。
- 中断、重试、重复、缺图、校验错误、协议版本不支持。
- 重启后不重复摄取。
- 伴侣未授权时不能共享原文。
- WorkBuddy 不可用时附件 JSON 降级可用。
- Git、发布包、备份和日志均不包含原始聊天。

## 7. 验收标准

- 桌面和手机均不再显示「导入」一级导航。
- 未授权时不调用 WorkBuddy，不读取收件箱。
- 半成品、符号链接、越界路径和错误校验值不进入鹊信。
- 同一批次或消息重复放入只处理一次。
- 原始聊天只产生待确认候选，不自动写成事实。
- 双人共享前明确展示可见范围并单独确认。
- WorkBuddy 失败时青鸟显示真实错误和可恢复路径。
- 手动 JSON/TXT/图片/录音仍可从青鸟「+」入口使用。
- 私人聊天路径不进入 Git、浏览器完整备份、发布包和普通日志。

## 8. 时间估算

- 仅“WorkBuddy 执行 + 安全文件夹交接”：3–5 个工作日。
- 加上鹊信第三方应用/Open API 调用，实现青鸟全自动发起 WorkBuddy：5–8 个工作日，且受 WorkBuddy 开放平台审核和授权进度影响。

## 9. 实施顺序约束

严格按 P13.0 → P13.1 → P13.2 → P13.3 → P13.4 执行。不能先删除导入导航、再希望 WorkBuddy 适配器以后补齐；必须先保证收件箱和降级路径可用，再收敛前台入口。
