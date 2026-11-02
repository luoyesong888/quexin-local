# 鹊信 PWA 后台同步验收

更新日期：2026-10-29

## 实现

- App 全局监听可共享回忆、计划和文字变化，无需进入设置页即可写入 `quexin-sync-state`。
- 同一工作区的入队与前台同步使用 Web Lock 串行化。
- IndexedDB 保存后通过 BroadcastChannel 通知其他标签；Service Worker 完成后通过 `postMessage` 通知页面。
- 构建生成的 `sw.js` 监听 `quexin-sync`，从 IndexedDB 读取命令，通过同源 `/formal` 接口携带 Cookie 提交，并更新 revision、hash、冲突和失败退避。
- 失败诊断支持 JSON 下载；连续失败 5 次或等待超过 24 小时显示提醒。

## 自动化

- 常规 E2E：4/4 通过，其中双标签同时同步后服务端实体只增加一次 revision。
- 生产 PWA E2E：1/1 通过。测试在离线编辑完成后关闭原页面，再由已激活 Service Worker 读取队列并完成同步。
- Headless Chromium 禁用系统级 Background Sync 自动调度，因此测试以直接唤起 Worker 的 `runBackgroundSync()` 验证确定性行为；`sync` 事件注册代码由构建产物语法检查覆盖。

## 边界

不同移动浏览器可能限制 Background Sync，iOS 支持尤其取决于系统与安装方式。能力不可用时，队列不会丢失，用户下次打开页面后由前台同步继续处理。
