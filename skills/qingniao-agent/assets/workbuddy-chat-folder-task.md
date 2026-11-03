# WorkBuddy × 鹊信聊天提取任务模板

请严格执行以下本地任务，不要扩大范围：

1. 只处理用户本次明确授权的单聊对象、日期范围和消息类型。
2. 不持续监控微信，不修改微信数据，不扩展到其他联系人或群聊。
3. 将 WorkBuddy 原始导出写入：`{{SOURCE_DIR}}`。该目录必须位于用户的 WorkBuddy 工作目录，不能位于鹊信源码、`public/`、Git 或发布包内。
4. 保留发送者、原始时间、消息顺序、文本和图片相对引用。不知道的值标记为缺失，禁止推测或补写。
5. 失败时保留真实错误，不生成伪造成功文件。
6. 原始导出完成后，运行以下兼容转换命令：

```bash
cd {{QUEXIN_PROJECT_SHELL}}
node scripts/workbuddy-chat-bridge.mjs convert \
  --source {{SOURCE_DIR_SHELL}} \
  --inbox {{INBOX_ROOT_SHELL}} \
  --space-id {{SPACE_ID_SHELL}} \
  --conversation-id {{CONVERSATION_ID_SHELL}} \
  --extractor-version "workbuddy-folder-handoff-1"
```

成功标准：命令返回 `ok: true`，且产物仅出现在鹊信交换箱的 `ready/<batchId>/`。不要读取或修改鹊信 IndexedDB。
