# 完整产品 P4：导入与识别

日期：2026-10-31。P4 的本地格式、导入恢复、OCR/录音代理和测试提供商验收已完成；当前电脑没有实际模型密钥，因此真实图片与音频的识别质量尚未验收，P4 不能标记为最终通过。

## 已实现

- 本地导入支持粘贴文字、TXT、JSON、CSV 和 HTML。CSV 识别中英文常用表头、引号与逗号；HTML 支持消息列表、常见消息节点和表格导出。
- 文件策略固定：文字 2 MB、图片 10 MB、录音 25 MB；一次最多 1,000 条消息和 10 万字。未知格式、错误表头、错误 JSON/CSV 不替换当前内容。
- 导入步骤 1—2 自动保存到当前账号 IndexedDB，包含文字、文件名、来源类型、人物映射、基准日期、选择范围和步骤。刷新后恢复，账号之间隔离，并进入浏览器 JSON 备份。
- 图片与音频二进制不写入导入草稿。刷新后保留文件名并提示重新选择，避免把大文件长期写入浏览器资料库。
- 图片 OCR 要求登录和逐次同意，只发送当前选择的图片；支持 JPEG、PNG、WebP、非动画 GIF。服务端以 Responses API 图片输入调用配置的 vision 模型。
- 录音转写要求登录和逐次同意，服务端以 multipart 文件转发到 `/audio/transcriptions`。支持 flac、mp3/mp4/mpeg/mpga、m4a、ogg、wav、webm。
- 两种识别都支持浏览器取消并向上游传播 AbortSignal；超时、未配置、非法格式和网络错误保留手动填写入口。
- OCR/转写结果只填入可编辑文本框。用户人工校正、核对人物/日期、生成候选并逐条确认后，才能成为正式记录。
- 来源标记区分图片人工填写、图片 OCR、录音转写、CSV、HTML、JSON/TXT 和虚构样例，保留整理文本行号与人物映射。
- 微信不直连个人账号或数据库，只接受用户主动粘贴或自行选择的合法导出文件。

## 验收

| 检查 | 结果 |
| --- | --- |
| P3/P4 模型与识别套件 | 15/15：OCR、录音、逐次同意、非法类型、取消，以及模型结构/引用/失败回退 |
| 导入套件 | 13/13：文字/文件/CSV/HTML、刷新恢复、二进制不持久化、来源、重复、日期与隐私 |
| 保存与备份恢复 | 2/2，通过新增导入草稿元数据后的慢写入和跨浏览器恢复 |
| 网页同步回归 | 4/4，离线队列、冲突、多标签和数据生命周期 |
| 构建 | TypeScript、Vite、PWA 资源生成通过 |

测试识别提供商确认：图片请求只包含当前文件，不包含已有回忆；音频使用 multipart；未登录返回 401；缺少逐次同意返回 `CONSENT_REQUIRED`；不支持格式返回 `VALIDATION_FAILED`；取消会关闭上游连接。

截图：[OCR 后人工校正](product-p4-qa/ocr-correction.png)、[录音转写后人工校正](product-p4-qa/audio-transcript.png)、[刷新恢复人物与范围](product-p4-qa/restored-draft.png)。

## 官方依据与边界

- [OpenAI 图片输入官方文档](https://developers.openai.com/api/docs/guides/images-vision?api-mode=responses)说明，Responses API 可接收 Base64 图片输入；OCR 需要足够的图像细节，识别结果仍需考虑视觉模型限制。
- [OpenAI 文件转写官方文档](https://developers.openai.com/api/docs/guides/speech-to-text)说明，文件转写接口使用 multipart `/audio/transcriptions`，适用于已完成录音，官方列出的上限为 25 MB。本项目沿用该上限。
- 测试提供商不会证明真实图片清晰度、口音、多人说话、噪音、模型账户权限、费用或稳定性。
- 没有微信官方能力与授权前，不实现“自动读取个人微信”。P4 当前完成的是主动选择文件和粘贴路径。

## 完成 P4 仍需要

在 `.env.local` 配置实际可用的 `ASSISTANT_API_KEY`、支持图像输入的 `ASSISTANT_MODEL` 与 `ASSISTANT_TRANSCRIPTION_MODEL`，完成至少一张真实聊天截图、一段真实录音和一份匿名导出文件的识别、人工校正、来源查看和候选确认。没有这些配置时，识别按钮会返回未配置错误，文字文件和手动填写仍可完整使用。
