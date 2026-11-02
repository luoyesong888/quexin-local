# 手机 PWA Demo 验收

日期：2026-10-27（Asia/Shanghai）  
生产预览：`http://localhost:4189/`  
局域网预览：`http://192.168.0.109:4189/`  
工具：Playwright CLI + 独立临时 Chrome；手机视口为 390 × 844。

结论：本轮 PWA 注册、缓存、离线刷新、更新保护、LAN 降级和 Chromium 安装条件检查通过。没有在用户设备实际安装应用，不能把安装条件检查当成已完成安装。

## 实测结果

| 项目 | 观察结果 | 判定 |
| --- | --- | --- |
| Manifest | 返回 HTTP 200；Content-Type 为 `application/manifest+json`；名称“鹊信”、standalone、起始范围 `/` 正确 | 通过 |
| 首次生产注册 | localhost 为安全上下文；Worker 达到 `activated`；首载 `controller=false` | 通过 |
| 首载后手动刷新 | `navigator.serviceWorker.controller` 存在，页面受控 | 通过 |
| 预缓存 | 实际枚举到 13 个静态资源，包含 HTML、JS、CSS、图标、manifest、宠物、3 间房间、3 张照片 | 通过 |
| 离线刷新 | 浏览器上下文设为 offline 后重新载入首页，标题、布局、脚本和样式正常 | 通过 |
| 离线图片 | 7 张演示图片在断网状态下全部返回 200，完整字节内容可读取 | 通过 |
| 离线交互 | 进入鹊巢并喂点心成功：羽光 36→39、能量 78→90，界面即时更新 | 通过 |
| 恢复网络 | `navigator.onLine=true`，manifest 再次返回 200 | 通过 |
| 更新保护 | 新 Worker 完成安装后保持 waiting/installed；旧 Worker 仍 activated；未保存标题和正文保留 | 通过 |
| 页面未被强制刷新 | 更新前后 `performance.timeOrigin` 相同；编辑器未关闭、未重建页面 | 通过 |
| API 不进入缓存 | 本地模拟 `/api/pwa-cache-probe` 返回 200 JSON，检查所有缓存均无该 API、无 export 路径 | 通过 |
| LAN HTTP 降级 | 页面正常；`isSecureContext=false`，没有 Service Worker API，没有 `/sw.js` 请求 | 通过 |
| Chromium 安装条件 | 普通临时 profile 的 `Page.getInstallabilityErrors` 返回空数组；manifest 解析错误为空 | 通过 |
| SVG 图标 | 本轮 Chromium 安装条件诊断未报告图标尺寸、类型或缺失错误 | 通过 |

## 缓存清单

首轮测试缓存：`quexin-static-75b8ed9f1a2f27da5f1e`，共 13 项；构建统计约 9.96 MiB。

```text
/app-icon.svg
/assets/cafe.jpg
/assets/coast.jpg
/assets/index-C1IhRvr7.js
/assets/index-D1GxfUKl.css
/assets/mountain.jpg
/assets/pet-sprites.png
/assets/room-cosmos.png
/assets/room-garden.png
/assets/room-study.png
/favicon.svg
/index.html
/manifest.webmanifest
```

后续重新构建会改变 bundle 文件名和缓存哈希，这是预期行为。

| 离线资源 | 状态 | 内容字节数 |
| --- | --- | ---: |
| pet-sprites.png | 200 | 1,805,171 |
| room-study.png | 200 | 2,111,262 |
| room-garden.png | 200 | 2,609,042 |
| room-cosmos.png | 200 | 2,475,836 |
| coast.jpg | 200 | 299,381 |
| cafe.jpg | 200 | 348,819 |
| mountain.jpg | 200 | 257,455 |

## 更新与缓存边界

为验证真实更新，测试短暂替换了构建产物 `dist/sw.js` 的缓存版本后调用 `registration.update()`。待新 Worker 安装完成，实际读到：

```json
{
  "waiting": "installed",
  "installing": false,
  "active": "activated",
  "sameDocument": true,
  "unsavedTitle": "PWA 更新期间未保存的标题",
  "unsavedBody": "这段文字尚未保存，更新不应该把编辑器刷新掉。"
}
```

验证后已恢复原始 `dist/sw.js`；恢复时 SHA-256 为 `921f744aaba012264411506156ee26a8a609b27766d8ea9b96706f057515e3cb`。没有修改源代码、没有让测试更新成为交付版本。

实际缓存内容全部位于静态白名单。API 200 探针未被缓存；对生成脚本及 Worker 的审查确认：只处理同源 GET；排除 api/auth/upload/export；只缓存成功的非重定向静态响应；清理仅针对 `quexin-` 前缀；没有访问 localStorage、保存私人记录、强制 skipWaiting 或自动刷新编辑页。

## 安装条件与环境区别

- 无痕会话最初返回 `in-incognito`，是测试会话限制。
- 随后使用独立普通临时 profile 重测：`Page.getInstallabilityErrors.installabilityErrors=[]`，`Page.getAppManifest.errors=[]`。
- 浏览器产生了 `beforeinstallprompt` 事件。应用阻止自动 banner、等待用户点击安装入口，属于预期行为。
- 此结果只证明本次 Chromium 环境满足安装检查；没有操作真实手机“添加到主屏幕”，也未验证 iOS 安装图标表现。
- LAN HTTP 仅供同 Wi-Fi 手机预览；安装和 Service Worker 离线能力应在 HTTPS 或受信任 localhost 上体验。

## 390 × 844 截图与视觉反馈

- `reports/mobile-pwa-offline-home-390x844.png`：断网刷新后的首页。
- `reports/mobile-pwa-offline-nest-390x844.png`：断网喂点心后的鹊巢。

首轮鹊巢截图发现喂食姿态的鸟头被右侧边界裁切，已反馈主代理调整移动端 sprite 尺寸/位置。图片已成功缓存和加载，问题属于移动端布局。本轮未擅自修改主页面或样式。

另见 Chromium 非阻断提示：建议在 Apple mobile-web-app-capable 声明之外补充通用 `mobile-web-app-capable` meta，已反馈主代理。

本次只使用独立测试 profile；测试结束关闭会话，未使用用户日常浏览器或真实资料。
