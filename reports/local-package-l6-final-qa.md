# 本地发布包 L6：最终交付验收

日期：2026-11-02（个人 Agent 更新后复验）。L1—L6 全部完成。最终发布包从压缩文件开始，在路径含空格和中文的全新目录中由 WorkBuddy 独立安装，不依赖开发目录的 `.env.local`、`.local-data`、`node_modules` 或数据库。

## 最终发布物

| 文件 | 说明 |
| --- | --- |
| `release/artifacts/quexin-local-macos-v0.1.0.tar.gz` | macOS 本地发布包，约 9.5 MB |
| `release/artifacts/quexin-local-macos-v0.1.0.tar.gz.sha256` | 系统 SHA-256 校验文件 |
| `release/artifacts/quexin-local-macos-v0.1.0.manifest.json` | 包外文件/版本/权限清单 |

- 版本：0.1.0
- 文件数：134
- 解压文件总字节：11,025,090
- 最终 SHA-256：`890b1b6de9e7389843aa23d9830b9664c1dcd121951349ebc590b4ba55ed97df`

## 从最终压缩包完成的真实验收

1. 包外 SHA-256、包内/包外 manifest、路径和文件摘要通过。
2. 解压到含中文与空格的全新路径，预检确认没有依赖、数据或隐藏配置。
3. WorkBuddy 使用 lockfile 离线安装依赖，初始化独立 PostgreSQL 和随机密钥，启动五组件。
4. `local:doctor` 通过，默认能力为本地检索、人工文字和 local outbox。
5. 两个独立正式账号完成本地邮件验证；设置页写入假 DeepSeek Key，读取接口不回传密钥，自动重启后能力状态生效。
6. 发布包包含通过规范校验的 `qingniao-agent` Skill、十个运行时 Skill、十个产品工具和关闭的微信聊天提取能力门禁；桌面/手机青鸟均为可普通对话、无分页和无模式按钮的统一聊天界面。
7. 创建空间和邀请码加入，共同回忆从甲同步到乙。
8. 真实 JPEG 上传、清洗、WebP 缩略图与双方权限通过。
9. 未到期安全胶囊返回 423；到期共享胶囊由另一账号读取正文。
10. 浏览器端完成文本导入、候选确认和写信。
11. 浏览器 JSON 在第二个空白浏览器资料库恢复，导入回忆可搜索。
12. WorkBuddy 服务端停机备份后新增资料，再恢复到新数据库；备份后新增资料消失，旧共同回忆和媒体仍可读取。
13. 五组件停止、再次启动和健康检查通过。

证据：[最终发布包摘要](local-package-l6-qa/final-release-summary.json)、[完整回归摘要](local-package-l6-qa/full-summary.json)、[全新安装截图](local-package-l6-qa/installed-settings.png)、[Agent 工作台截图](local-package-l6-qa/installed-agent.png)。

## 最终完整回归

`npm run test:full -- --postgres` 共 42 个验收任务全部通过（438 秒），覆盖：

- 临时 PostgreSQL、维护、通知、列级权限和恢复；
- P1—P9 产品功能、双账号、隐私、生命周期和 PWA；
- L1 预检、L2 部署、L3 发布校验、L4 可选配置、L5 生命周期；
- 青鸟统一聊天、普通多轮对话、个人 Agent 十个 Skill、十个产品工具、26 条 AI/Agent 流程、自动意图路由、附件、资料范围、可编辑审批、微信门禁、越权拒绝、取消和备份恢复；
- 23 条 WCAG/键盘/主题检查、五环境兼容、1,000/500/300 性能数据、34 条视觉回归和生产构建。

## 最终交付边界

- 支持 macOS arm64/x64 本地安装；Node.js 22.12+、PostgreSQL 17。
- 默认不连接公网服务，不要求模型、OCR、转写或 SMTP 密钥。
- 使用者可在设置页或通过 WorkBuddy 选择性配置自己的外部服务；页面要求当前密码，密钥只留在本机且不通过读取接口回传。
- 不包含公网部署、手机真机/原生 App、微信直连、跨电脑自动同步、系统关闭浏览器后的精确定时、端到端加密或可信时间证明。

发布资产已具备上传 GitHub Release 的条件；GitHub 仓库创建和上传属于外部发布操作，尚未执行。
