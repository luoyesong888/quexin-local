# P9 青鸟 Agent 与 Skill 验收

日期：2026-11-01。

## 已实现

- `skills/qingniao-agent/` 通过 Skill Creator 校验，包含 `SKILL.md`、工作流/审批参考、运行时目录和 Codex UI 元数据。
- DeepSeek/OpenAI 兼容 Responses API 新增 `quexin_agent` 严格 JSON Schema；Skill、步骤、来源和草稿动作均由服务端白名单复核。
- 青鸟侧栏新增 Agent 工作台：新导入发现、图片连续工作流、计划跟进、自定义目标、多轮关系回顾和最近运行。
- 回忆、计划、ICS 与邮件草稿逐项审批；拒绝不产生副作用。邮件仅打开本机客户端，日历仅下载 ICS。
- Agent run、轮次、来源 ID、步骤、审批与真实结果保存在当前浏览器资料库；旧资料库缺少 `agentRuns` 时按空列表兼容。

## 安全边界

- 自动发现只看鹊信已有候选，不扫描微信、磁盘、邮箱或日历。
- 私人、敏感、已忽略内容不进入 Agent 来源选择。
- 模型不能选择目录外 Skill，不能引用未发送来源，不能把草稿声称为已执行。
- 不做关系裁决、心理诊断、忠诚度判断或自动对外发送。

## 自动验收

- `npm run test:qingniao-skill`：Skill 包、六项目录和服务端白名单一致。
- `npm run test:ai`：自动发现、图片 OCR→回忆→计划→ICS、计划+邮件多 Skill、多轮回顾、持久化、来源范围和越权 Skill 拒绝通过。
- 最终完整回归与发布包结果见 `local-package-l6-final-qa.md`。

## 外部参考

- Agent Skills specification: https://github.com/agentskills/agentskills/blob/main/docs/specification.mdx
- LangGraph human-in-the-loop: https://github.com/langchain-ai/langgraphjs/blob/main/docs/docs/agents/human-in-the-loop.md
- LangGraph persistence: https://github.com/langchain-ai/docs/blob/main/src/oss/langgraph/persistence.mdx
