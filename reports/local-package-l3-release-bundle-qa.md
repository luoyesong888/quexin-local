# 本地发布包 L3：macOS 可分发包与完整性校验

日期：2026-11-01。L3 已完成，第一份可分发 macOS 发布包已经生成并通过内部、外部与系统 SHA-256 校验。

## 已实现

- `npm run release:bundle`：按 `release/local-release-spec.json` 白名单收集文件。
- `npm run release:verify -- <包或目录>`：验证归档或解压目录。
- 包内 `release-manifest.json`：版本、平台、Node/PostgreSQL 要求、121 个文件的路径/大小/权限/SHA-256。
- 包外 `.manifest.json`：必须与包内 manifest 完全一致。
- 包外 `.tar.gz.sha256`：下载后可先用系统 `shasum` 验证。
- 原子生成：先在临时目录完成压缩和摘要，成功后才移动到 artifacts；默认拒绝覆盖已有同版本，显式 `--overwrite` 才替换生成物。
- 归档解压前检查：拒绝绝对路径、`..` 路径穿越、非 `quexin-local/` 根目录和链接条目。
- 解压后检查：拒绝额外文件、缺少文件、禁止路径、权限变化、大小变化、内容摘要变化和统计不一致。
- 发布包中的 `package.json` 只保留本地运行/部署命令，移除指向未打包测试和开发脚本的命令。

## 明确排除

发布物不包含 `.local-data`、`.env.local`、数据库、照片、备份、密钥、日志、`node_modules`、`dist`、测试结果、报告、测试源码、Playwright 配置、Git 和内部计划。

## 实际生成物

| 文件 | 说明 |
| --- | --- |
| `release/artifacts/quexin-local-macos-v0.1.0.tar.gz` | 约 9.5 MB 的本地发布包 |
| `release/artifacts/quexin-local-macos-v0.1.0.tar.gz.sha256` | 系统 SHA-256 校验文件 |
| `release/artifacts/quexin-local-macos-v0.1.0.manifest.json` | 包外发布清单 |

- 版本：`0.1.0`
- 当前文件数：125（已包含 L5 生命周期工具）
- 当前解压文件总字节：10,922,706
- 当前归档 SHA-256：`2d74e00806fb549122cf279777ab9ef86159f701ea90810fd76ead3ed031d8f1`

## 验收结果

- 白名单打包与正常校验：通过。
- 重复生成未加 `--overwrite`：正确拒绝。
- `.env.local` 注入：正确拒绝。
- 包外 manifest 篡改：正确拒绝。
- 解压文件内容/权限/大小篡改：正确拒绝。
- 归档追加字节：SHA-256 正确拒绝。
- `scripts/test-*`、`scripts/dev-*` 与其他禁止目录扫描：未进入包内。
- 系统命令 `shasum -a 256 -c`：`OK`。
- L3 专项测试：1/1 通过。

## 下一阶段

L4 完成首次使用与可选能力配置：零密钥保持本地模式可用；WorkBuddy 可安全写入用户自己的模型/OCR/转写/SMTP 配置，并在不显示密钥的情况下检查状态。
