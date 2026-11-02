# 本地发布包 L2：WorkBuddy 一键部署流程

日期：2026-10-31。L2 已完成，WorkBuddy 通过一个固定入口即可检查、安装、启动、查看状态、诊断、备份、验证和停止鹊信。

## 已实现

- `scripts/workbuddy-deploy.mjs`：`check/install/start/status/doctor/backup/stop/verify`。
- `npm run workbuddy:deploy -- <命令>`。
- `install` 与 `backup` 默认只展示计划，必须明确添加 `--yes` 才修改状态。
- 原子部署锁和 PID 归属检查，阻止两个 WorkBuddy 同时初始化或备份。
- 首次安装按 `package-lock.json` 执行 `npm ci`，创建独立 PostgreSQL、随机密钥、五组件并做数据库健康检查。
- 重复安装识别已有配置，不重新初始化、不覆盖数据库与密钥。
- 备份会记录原运行状态：必要时停机，完成一致性备份后自动恢复。
- `workbuddy-install.json` 记录 Node 版本、lockfile SHA-256、地址和“是否保留已有数据”，权限 600。
- `workbuddy-deploy.log` 只记录动作结果，不记录数据库连接或密钥。
- [DEPLOY_WITH_WORKBUDDY.md](../DEPLOY_WITH_WORKBUDDY.md) 提供固定步骤、安全约束和命令边界。

## 验收

| 场景 | 结果 |
| --- | --- |
| 未带 `--yes` 的 install/backup | 仅展示计划，退出码 2，不创建数据库/备份 |
| 首次 install | 初始化、五组件启动、健康检查通过 |
| 重复 install | 账号可继续登录，已有资料和密钥保留 |
| status/doctor/verify | 五组件、迁移、角色、目录权限和数据库 ready 正确 |
| backup --yes | 停机备份、生成目录、恢复原运行状态通过 |
| stop 重复执行 | 幂等，资料保留 |
| 并发部署 | 第二个操作被 PID 锁拒绝，未创建配置 |
| 无 node_modules、路径含空格 | `npm ci --offline` 安装锁定依赖后完整部署通过 |
| 专项测试 | 3/3 通过 |
| 构建 | 通过 |

当前正式本地实例的 WorkBuddy `status`、`verify` 和 `doctor` 也已只读通过；地址仍为 `http://127.0.0.1:4188/`。

## 下一阶段

L3 生成真正可分发的 macOS 压缩包、release manifest 和 SHA-256，并验证禁止文件不会进入包内、篡改后校验失败。
