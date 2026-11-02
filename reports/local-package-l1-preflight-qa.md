# 本地发布包 L1：发布边界与 WorkBuddy 预检

日期：2026-10-31。L1 已完成，只读预检不会安装软件、初始化数据库、停止服务或修改用户资料。

## 已实现

- `WorkBuddy部署检查.command`：不依赖 npm；缺少 Node.js 时直接给出版本要求并退出，不静默安装。
- `scripts/workbuddy-preflight.mjs`：人类可读与 `--json` 两种输出。
- `scripts/lib/workbuddy-preflight.mjs`：采集 macOS、CPU、Node/npm、PostgreSQL 17 工具、浏览器、必需文件、依赖、磁盘、端口和数据目录状态。
- `release/local-release-spec.json`：首版 macOS/arm64/x64 发布白名单和禁止项。
- `npm run workbuddy:check` 与 `npm run test:workbuddy-preflight`。
- 完整回归编排已加入 `workbuddy-preflight` 门禁。

## 发布边界

允许进入后续本地包的内容仅为运行源码、静态资源、服务端、迁移、脚本、锁文件、配置模板与说明。明确排除：

- `.local-data`、数据库 dump、媒体、备份、运行配置和密钥；
- `.env.local`；
- `node_modules`、`dist`、缓存；
- 测试结果、报告、测试源码、Playwright 记录和 Git/计划资料；
- 服务日志与 PostgreSQL 日志。

## 验收结果

| 场景 | 结果 |
| --- | --- |
| 合格 macOS/Node/PostgreSQL 环境 | 通过 |
| 缺 Node/npm/PostgreSQL/浏览器 | 正确阻断并给出建议 |
| 非鹊信端口冲突、磁盘不足 | 正确阻断 |
| 已有资料、当前鹊信正在运行 | 仅提醒，要求备份/停机，不误删数据 |
| 真实临时数据目录与哨兵文件 | 检查前后内容不变 |
| 无 Node 的 `.command` bootstrap | 只提示，不安装、不初始化 |
| 发布白名单/禁止项 | 7/7 自动测试通过 |
| 前端/服务端构建 | 通过 |

当前开发机真实预检：17 项通过、4 项提醒、0 项错误。提醒为 4188/4193/4191 正由当前鹊信使用，以及发现已有 `.local-data`；这正是升级场景应得到的结果。

## 下一阶段

L2 实现 WorkBuddy 统一部署入口：`check/install/start/status/doctor/backup/stop`，其中 `install` 必须幂等且不覆盖已有资料。
