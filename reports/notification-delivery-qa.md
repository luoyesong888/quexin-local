# 鹊信加密通知与 SMTP 验收

更新日期：2026-10-30

## 实现

- 验证邮箱、密码重置和系统告警共用持久化通知队列。
- 敏感载荷使用 AES-256-GCM 加密，数据库不保存明文令牌。
- 支持本机 Outbox、JSON 测试、HTTP Webhook 和 SMTP 四种驱动。
- SMTP 支持连接自检、TLS/STARTTLS、Message-ID、accepted/rejected 回执。
- 失败采用 30 秒起步指数退避，5 次后进入 `dead`。
- 登录用户只看到自己邮箱的类型、状态、次数和回执，不会看到密文。

## 验收

- AES-GCM 加密与解密：通过。
- 中文 HTML/纯文本验证模板：通过。
- Nodemailer JSON transport：通过。
- Message-ID、provider、accepted/rejected 入库：通过。
- MemoryStore API：9/9 通过。
- PostgreSQL API：9/9 通过。
- Sharp 0.35.5 图片回归：通过。
- `npm audit`：0 个已知漏洞。

测试不会连接真实 SMTP；真实发送必须由部署者提供 SMTP 凭据。
