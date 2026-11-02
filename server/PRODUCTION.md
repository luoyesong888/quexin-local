# 鹊信正式 API 开发说明

当前包含两种后端：

- `mock-server.mjs`：设置页同步实验室使用的本地 JSON 模拟服务。
- `prod-server.mjs`：正式认证、HttpOnly 会话、权限与同步 API。`--memory` 只用于契约测试；不带该参数时必须提供 PostgreSQL `DATABASE_URL`。

## 本地认证接口测试

```bash
npm run test:api
```

测试运行器会启动内存版正式 API，不需要 PostgreSQL。测试内容包括响应 Schema、认证 Cookie、401/403/404/409/429、双人上限、幂等、隐私、版本冲突，以及真实 JPEG 的摘要校验、WebP 转码、缩略图和媒体读取权限。

本地脚本设置 `DEV_MAILBOX=true`，允许回环地址读取最近一封验证/重置令牌，用于自动测试和设置页体验。正式环境不得开启该变量；生产应将令牌交给邮件队列和服务商。

## PostgreSQL 准备

建议由迁移账号创建 schema，再由权限受限的应用账号运行服务。应用账号不应是超级用户、表所有者或具有 `BYPASSRLS`。

```sql
CREATE DATABASE quexin;
CREATE ROLE quexin_app LOGIN PASSWORD '使用密码管理器生成';
```

使用迁移账号设置 `DATABASE_URL` 后：

```bash
npm run db:migrate
```

迁移时通过 `DATABASE_APP_ROLE=quexin_app` 自动刷新权限。脚本会先授予业务表所需权限，再对维护、告警和通知表收紧为列级只读/入队权限；不要在迁移后手工重新授予所有表 `ALL`，否则会重新暴露通知密文和内部错误详情。

正式服务使用应用账号的连接串启动：

```bash
DATABASE_URL='postgres://quexin_app:...@127.0.0.1:5432/quexin' \
PUBLIC_ORIGIN='https://your-domain.example' \
node server/prod-server.mjs
```

API、维护和通知投递必须作为独立进程运行：

```bash
MAINTENANCE_DATABASE_URL='postgres://...' node server/maintenance.mjs
NOTIFICATION_DATABASE_URL='postgres://...' NOTIFICATION_ENCRYPTION_KEY='...' \
NOTIFICATION_DRIVER=smtp SMTP_URL='smtps://...' node server/notification-worker.mjs
```

部署前运行 `npm run production:doctor`；需要验证 SMTP 连接与认证但不发送邮件时运行 `npm run production:doctor -- --external`。

## 安全边界

- 密码使用随机盐的 `scrypt`，数据库不保存明文。
- 浏览器只收到随机会话令牌；数据库只保存令牌 SHA-256，Cookie 设置 `HttpOnly` 和 `SameSite=Lax`，HTTPS 环境自动添加 `Secure`。
- 写操作检查请求 Origin；登录接口有进程内限流。生产多实例时应迁移到共享限流存储。
- PostgreSQL 为情侣空间、共享实体和事件启用行级安全；应用请求在事务中设置 `app.user_id`。
- 私人实体只对 owner 返回；服务端仍会在业务层再次检查成员资格。
- 媒体表只保存存储键、摘要、资料关联和权限，不存公开永久 URL。本机阶段由 `.local-data/media/` 保存重新编码后的 WebP 和缩略图；读取和删除必须经过会话、空间与 owner 权限。
- 图片输入上限 10MB，支持 JPEG/PNG/WebP；Sharp 负责解码、自动方向、尺寸限制和重新编码，原文件及其元数据不会直接落盘。
- `GET /v1/spaces/:id/sync/status` 返回游标、分类实体数和媒体处理状态；`POST /v1/spaces/:id/media/cleanup` 仅允许 owner 清理已删除媒体的数据库墓碑与残留文件。
- 同步命令 ID 保证 Service Worker、前台页面或多个标签页重复提交时幂等；浏览器端使用 Web Locks 降低并发，服务端幂等仍是最终防线。
- 时光胶囊正文使用 `CAPSULE_ENCRYPTION_KEY` 派生的 AES-256-GCM 密钥静态加密。列表与未到期读取不返回正文、密文、IV 或认证标签；这不是端到端加密，服务端持钥者具备解密能力。

## 尚未完成

- SMTP 驱动、加密发送队列、租约恢复、指数退避、dead 告警和邮件链接页面已实现；真实邮件服务商收件、退信与声誉监控尚未完成验收，本地开发邮件箱不能用于生产。
- S3 兼容对象存储签名上传与病毒/内容扫描；当前只实现本机私有媒体目录和 owner 手动孤儿清理。
- 多实例共享限流、外部监控/告警投递、集中审计和异地灾备。

## 本机 PostgreSQL 验收状态

迁移已推进到 `022_notification_leases.sql`，覆盖正式 API、共同宠物、数据生命周期、共享撤回、账号注销、可过期关怀分享、安全时光胶囊、可追溯成长来源、文件清理重试、维护、加密通知与投递租约。完整回归在临时独立 PostgreSQL 集群执行，不清空现有业务库；API 测试使用受限应用角色。最新记录见 `reports/product-p8-operations-delivery-qa.md`。

迁移账号执行后可通过 `DATABASE_APP_ROLE` 刷新新表权限：

```bash
DATABASE_URL=postgres://... DATABASE_APP_ROLE=quexin_app npm run db:migrate
```

正式数据包保存在 `EXPORT_ROOT`（默认 `.local-data/exports/`），文件权限为仅当前系统用户可读写。下载授权与数据库任务绑定，24 小时后接口拒绝读取；维护进程负责回收数据库任务和物理文件。

维护进程使用 `MAINTENANCE_DATABASE_URL` 绕过普通应用 RLS，只承担：过期导出文件、陈旧上传、到期空间、过期/撤销会话和账号令牌清理。每次运行写入 `maintenance_runs`；普通登录用户只能读取最近状态，不能伪造维护记录。生产应把维护连接串放入独立密钥并限制网络与数据库权限。

维护部分失败或完全失败时会写入 `system_alerts`。登录用户只能通过 API 查看未解决告警摘要，不能读取内部 `details` 或写入告警；外部告警转发仍需部署方配置。

通知队列中的令牌载荷使用 `NOTIFICATION_ENCRYPTION_KEY` 派生的 AES-256-GCM 密钥加密。普通应用角色通过列级权限只能 INSERT 及读取当前邮箱的状态，不能读取密文或更新任务。投递器领取任务时写入租约；陈旧 `sending` 可恢复，失败指数退避，第五次进入 `dead` 并生成幂等告警。SMTP 使用 Nodemailer，可通过 `smtps://` 或支持 STARTTLS 的 `smtp://` 连接；投递结果保存 Message-ID、accepted/rejected。JSON transport 仅用于测试。

胶囊密钥应与通知密钥、数据库密码分别生成，并与数据库一起备份。密钥丢失后已封存正文无法恢复；生产轮换密钥前必须先实现密文重加密流程，不能直接替换环境变量。
