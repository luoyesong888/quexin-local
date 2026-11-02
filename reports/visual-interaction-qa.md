# 本地收尾阶段四：视觉与交互验收

日期：2026-10-30。环境：Chromium 隔离浏览器会话，本机 Vite 4888 / 内存 API 4893。测试仅使用新建的虚构资料，不修改现有账号或业务数据库。

## 本阶段完成内容

- 手机“记录”面板的回忆、计划、信件每次点击都能打开编辑器，关闭后可重复创建；写信入口直接打开表单。
- 鹊巢“时光胶囊”卡片进入胶囊分类，按钮改为“去写时光胶囊”。
- 浏览器后退时关闭相关页面弹窗；平板通过助手跳转页面时收起覆盖层。
- Escape 关闭弹窗后，在原按钮仍存在且未打开另一个弹窗时恢复键盘焦点。
- 手机鹊巢压缩重复介绍，保留名称、改名入口、房间、宠物和状态条。390×844 下四个照顾按钮完整位于底栏上方，十套主题均校验。
- 修正安装指引、演示说明及数据页中过时的“无账号服务”等描述，区分浏览器本地资料、本机共同空间同步与未接入外部能力。

审查前发现及证据见 [UX 问题记录](ux-audit-stage4-2026-10-30.md)。

## 与参考图的对应

桌面沿用左导航、中间日常/导入/计划/鹊巢、右侧青鸟的结构，十套主题保留各自的颜色、字体、边框、背景和模块排序。手机继续使用先前确定的五项底栏和轻量首页，不直接缩小桌面三栏。宠物沿用参考中的金棕冠羽、蓝灰翅羽和脚上红绳，使用待机、开心、进食、睡眠四种姿态；没有新增角色或替换参考身份。

这里验收的是已实现网页与参考视觉方向的一致性和可操作性，不宣称逐像素复刻。房间仍为书房、庭院、星河三套素材，主题差异不等同于十套独立插画；宠物仍为平面素材和 CSS 动效。

## 测试结果

| 检查 | 覆盖与结果 |
| --- | --- |
| `npm run test:visual` | 32/32 通过：20 条主题用例、3 条响应式页面巡检、9 条操作流程 |
| 十套主题 | 1440×1000 和 390×844；通过设置切换、刷新保持、首页/鹊巢布局、宠物画布边界、可见图片加载失败检查 |
| 八个页面 | 320×740、768×1000、1920×1000；今日/导入/回忆/计划/关怀/鹊巢/创作/系统及设置子页，无工作区或整页横向溢出、无捕获到的页面脚本异常 |
| 创建与返回 | 回忆、计划、信件连续两次打开；浏览器返回退出表单；胶囊入口直达正确分类 |
| 回忆 | 空搜索、清空搜索、新建、编辑、取消删除、保存后刷新 |
| 鹊巢 | 四种姿态、布置、改名、写入完成后刷新保留；390px 主动作完整位于底栏上方 |
| 弹窗与助手 | Escape 退出、触发按钮焦点恢复；768px 助手导航后让出主页面 |
| 空状态与失败 | 新空间没有假回忆、空列表有记录入口、无效备份报错且资料不变 |
| 关怀与日历 | 需要选择、分享预览未发送、私人草稿保存、关怀加入日历、计划编辑、保留取消操作、完成/恢复 |
| 创作 | 信件保存/修改/阅读、胶囊未到期隐藏正文、导出的封面不含正文、年度回顾生成 |
| `npm run test:import` | 上一阶段 9/9 回归通过，包含手机导入与查看原文 |
| `npm run build` | TypeScript、Vite、PWA 构建通过 |

测试源码：[experience.spec.ts](../tests/visual/experience.spec.ts)。机器结果：[results.json](visual-interaction-qa/results.json)。

## 截图

已人工查看主题总览、素笺桌面原尺寸截图、320px 八页总览和修复后的星河手机鹊巢。自动截图不是像素差异基线测试；未使用截图一致来替代操作断言。

- [桌面十套主题总览](visual-interaction-qa/themes-1440.png)
- [手机十套主题总览](visual-interaction-qa/themes-390.png)
- [320px 八页总览](visual-interaction-qa/pages-320.png)
- [星河手机鹊巢：四个动作完整可见](visual-interaction-qa/nest-cosmos-390.png)
- [改名与换房间后的鹊巢](visual-interaction-qa/nest-actions-390.png)

主题总览从左到右、从上到下为竹影、山海、星河、胶片、松墨、墨白、碧玉、素笺、暖阳、明快；320px 总览依次为今日、导入、回忆、计划、关怀、鹊巢、创作、系统。

| 主题 | 桌面 | 手机 |
| --- | --- | --- |
| 素笺朱砂 | [查看](visual-interaction-qa/paper-1440.png) | [查看](visual-interaction-qa/paper-390.png) |
| 墨白留声 | [查看](visual-interaction-qa/ink-1440.png) | [查看](visual-interaction-qa/ink-390.png) |
| 明快日常 | [查看](visual-interaction-qa/vivid-1440.png) | [查看](visual-interaction-qa/vivid-390.png) |
| 竹影听风 | [查看](visual-interaction-qa/bamboo-1440.png) | [查看](visual-interaction-qa/bamboo-390.png) |
| 星河来信 | [查看](visual-interaction-qa/cosmos-1440.png) | [查看](visual-interaction-qa/cosmos-390.png) |
| 碧玉流光 | [查看](visual-interaction-qa/jade-1440.png) | [查看](visual-interaction-qa/jade-390.png) |
| 暖阳花序 | [查看](visual-interaction-qa/sunlight-1440.png) | [查看](visual-interaction-qa/sunlight-390.png) |
| 松墨鎏金 | [查看](visual-interaction-qa/heritage-1440.png) | [查看](visual-interaction-qa/heritage-390.png) |
| 胶片手账 | [查看](visual-interaction-qa/film-1440.png) | [查看](visual-interaction-qa/film-390.png) |
| 山海织锦 | [查看](visual-interaction-qa/brocade-1440.png) | [查看](visual-interaction-qa/brocade-390.png) |

## 未包含在本次验收的内容

- 实体 iPhone/安卓、Safari/Firefox、手机软键盘与系统后台行为；本次手机结果是浏览器视口模拟。
- 完整 WCAG 审计、所有文字对比度测量、大数据量性能和真实用户体验研究。
- 外部模型、OCR、微信直连及生产邮件投递，仍需独立接入与验证。
- 第五阶段的一键启停、全新环境启动、备份恢复和账号/同步完整回归尚待完成。整体进度为 4/5 阶段。
