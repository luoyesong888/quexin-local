# 鹊信正式 API 骨架验收

更新日期：2026-10-28

## 测试方法

使用 Playwright API request fixture 和 Zod 响应 Schema，在临时内存存储上启动正式 API。测试不依赖浏览器页面，不写入项目资料。

```bash
npm run test:api
```

## 结果

9 组测试分别在内存 Store 和 PostgreSQL 17.11 上全部通过：

1. 注册字段校验、成功注册、HttpOnly/SameSite Cookie、会话读取、退出和退出后 401。
2. 邮箱大小写去重、错误密码、SQL 注入样式邮箱输入和正确重新登录。
3. 创建情侣空间、一次性邀请码、第二位成员加入、第三人读取与写入 403。
4. 同步命令幂等、伴侣增量读取、版本冲突和私人记录隔离。
5. 登录尝试达到限制后返回 429、稳定错误码和 `retryAfterSeconds`。
6. 邮箱验证令牌门槛、令牌有效期与单次使用。
7. 忘记密码撤销旧会话、新密码登录，以及多个登录设备的单独撤销。
8. 图片意图与资料关联校验、错误摘要拒绝、JPEG 解码、WebP 与缩略图输出、双方共享、仅 owner 与空间外隔离；owner 删除、媒体墓碑清理、非 owner 清理拒绝、删除后 404 和重复操作幂等。
9. 正式数据包的共享/私人权限过滤、gzip 媒体副本、空间外 403、删除预约名称校验、撤销、owner 永久删除和媒体/导出文件级联清理。

所有测试响应均经过成功或错误 Envelope Schema 校验，不只检查 HTTP 状态码。

## 正式实现

- 密码：Node `scrypt`，随机盐，恒时比较。
- 会话：随机 256 位令牌，服务端只存 SHA-256 摘要；浏览器使用 HttpOnly、SameSite=Lax Cookie，HTTPS 自动添加 Secure。
- 邮箱/密码令牌：服务端只存 SHA-256 摘要，验证和重置后立即标记使用；密码重置撤销该账号全部旧会话。
- 设备管理：每个会话记录设备标识、创建时间、最近使用和失效时间，可单独撤销。
- 数据库：`pg` 连接池；事务使用同一连接执行 BEGIN/COMMIT/ROLLBACK。
- 权限：业务层成员检查与 PostgreSQL RLS 双重保护。
- 同步：唯一命令 ID、expectedRevision、游标事件和软删除。
- 媒体：本机私有目录、SHA-256、Sharp 重新编码、缩略图、无公开 URL、业务层与 RLS 双重授权。
- 运维读取：空间成员可查看同步游标、分类实体数和媒体状态；媒体清理只允许空间 owner。

## 未验证

目标公网环境、真实邮件投递、S3 对象存储、病毒扫描和多实例限流尚未验证。本机开发邮件箱、密码找回与本机媒体已经验证。

## PostgreSQL 17.11 真机验收

- 使用 Homebrew PostgreSQL 17.11 创建专用 `quexin_test` 数据库。
- 使用迁移账号应用七次迁移，包括账号令牌、设备会话、媒体字段、字符串实体 ID、媒体资料关联、导出任务和删除预约。
- 使用非超级用户、非表所有者、无 `BYPASSRLS` 的 `quexin_app_test` 运行正式 API。
- 同一套 9 组 Playwright API 测试全部通过。
- 首轮真实 RLS 测试发现伴侣更新共享实体时，空间 revision 更新被创建者专属 `WITH CHECK` 拒绝；已拆分 SELECT/INSERT/UPDATE/DELETE 策略并通过回归。
- 网页完成正式邮箱注册、HttpOnly Cookie 刷新保持、创建空间、退出和重新登录后恢复空间。
- 网页完成本地邮箱验证、忘记密码、新密码登录和当前设备显示。

## 备份恢复验收

使用 `pg_dump -Fc` 备份 `quexin_test`，恢复到专用 `quexin_restore_test`。恢复前后汇总完全一致：

```text
用户 0 | 空间 0 | 媒体 0 | 迁移 8 | RLS 策略 12
```

验收后已删除 `quexin_restore_test` 和临时 dump 文件。正式 UI/API 测试账号及空间也已从 `quexin_test` 清理，只保留数据库结构和迁移记录。
