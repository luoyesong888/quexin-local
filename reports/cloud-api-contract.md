# 鹊信双人云端接口契约（实施前版本）

更新日期：2026-10-28

## 目标

在不改写现有页面的前提下，把本地 Repository 替换为云端 Transport。所有页面继续使用同一领域模型；登录、空间、成员、权限、同步和媒体由服务端负责。

对应 TypeScript 契约：[cloud-contract.ts](../src/cloud-contract.ts)。

## 资源边界

| 资源 | 关键字段 | 权限原则 |
| --- | --- | --- |
| 用户会话 | `userId`, `expiresAt` | 只由服务端签发，前端不保存服务端密钥 |
| 情侣空间 | `spaceId`, `revision` | 最多两位正式成员 |
| 邀请 | 一次性 `code`, `expiresAt`, `status` | 可撤销、可过期、接受后不可再次使用 |
| 回忆/计划/文字 | `ownerId`, `visibility`, `revision` | 私人数据仅创建者；共享数据仅空间成员 |
| 原始来源 | 独立来源实体或加密引用 | 分享回忆不自动分享完整聊天原文 |
| 媒体 | 私有对象存储 ID | 通过短时授权访问，数据库不存公开永久 URL |
| 宠物动作 | 追加事件与唯一 `commandId` | 服务端计算奖励，重试不重复增加羽光 |

## 同步协议

1. 客户端为每次写入生成唯一 `commandId`。
2. 更新和删除携带 `expectedRevision`。
3. 服务端在事务中校验成员权限与实体版本。
4. 版本一致则提交并返回新修订号；版本不一致返回 `REVISION_CONFLICT` 和服务端当前值。
5. 客户端使用 `cursor` 增量拉取变化；断线后从上一次游标继续。
6. 删除采用软删除事件，其他设备同步失效后再进入延迟清理。

## 可见范围

- `private`：仅创建者；默认用于私人草稿、周期信息和未分享来源。
- `shared`：两位空间成员可见。
- `pending_partner`：对方可核对，但不作为已确认共同事实。
- `sealed_secret`：创建者可查看正文；接收方到揭晓条件满足后才取得正文。

## 第一批服务端接口

| 路径建议 | 方法 | 用途 |
| --- | --- | --- |
| `/v1/session` | GET | 当前登录会话 |
| `/v1/spaces` | POST | 创建情侣空间 |
| `/v1/spaces/:id/invites` | POST | 生成邀请 |
| `/v1/invites/:code/accept` | POST | 接受邀请 |
| `/v1/spaces/:id/sync` | POST | 批量提交幂等命令 |
| `/v1/spaces/:id/changes` | GET | 游标增量同步 |
| `/v1/spaces/:id/uploads` | POST | 申请私有媒体上传 |
| `/v1/spaces/:id/exports` | POST | 创建导出任务 |

## 错误格式

所有失败返回稳定的 `code`、面向用户的 `message` 和可追查的 `requestId`。表单错误放在 `fieldErrors`；限流返回 `retryAfterSeconds`。前端不根据中文错误文案判断逻辑。

## 服务端验收条件

- 两个账号加入同一空间，第三个账号的读取和写入均返回 `FORBIDDEN`。
- 对方无法读取私人草稿、周期详情和未分享的原始聊天。
- 两台设备同时编辑同一条回忆，其中一个收到带服务端当前值的冲突响应。
- 相同 `commandId` 重放不会重复创建记录或增加宠物奖励。
- 邀请过期、撤销和第二次使用均失败。
- 媒体 URL 过期后不能继续访问；导出只包含调用者有权读取的内容。
