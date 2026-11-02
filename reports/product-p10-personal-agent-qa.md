# P10 青鸟个人智能体验收

日期：2026-11-02。

## 实现

- Agent 默认进入“直接输入指令”，空白账号无需上传资料或先创建计划。
- 新增 `command-inbox`、`personal-memory`、`personal-planner`、`personal-journal`，运行时 Skill 从 6 个扩展为 10 个。
- 直接指令可生成待确认偏好/回忆、提醒/周期习惯、私人关怀、信件/日记草稿。
- 用户指令作为本次明确第一方来源；模型没有既有来源时必须保持 `sourceIds=[]`，不得伪造引用。
- 回忆、计划、创作和关怀分别审批；拒绝不写入，关怀默认私人，创作草稿标记为个人敏感内容。

## 微信门禁

- `wechat-chat-import` 只存在于 `capabilityGates`，`enabled=false`。
- 服务端 Skill 枚举不包含微信项，伪造 `availableSkills=['wechat-chat-import']` 会被拒绝。
- 启用条件：真实 WorkBuddy 提取适配器、明确授权、顺序/来源保留、代表样本、失败回退与隐私说明全部通过。

## 验收

- 空白账号直接输入偏好、周期计划、关怀和信件指令通过。
- 请求中 `sources=[] / plans=[]`，仍能得到可审批结构化草稿。
- 微信 Skill UI 明确显示“等待能力验证”，服务端拒绝伪造调用。
- Skill Creator 校验、AI/Agent 套件、完整回归和发布包结果见最终报告。
