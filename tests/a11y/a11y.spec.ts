import {test,expect} from '@playwright/test'
import {checkA11y,openDemo} from './helper'
import {themeOptions} from '../../src/domain'

const routes=['today','import','memories','planner','care','nest','create','settings'] as const

for(const route of routes)test(`${route} 页面通过 WCAG 2.2 A/AA 自动扫描`,async({page},testInfo)=>{
  await openDemo(page)
  await page.goto('/#'+route)
  await expect(page.getByRole('main')).toBeVisible()
  await checkA11y(page,testInfo,route)
})

for(const theme of themeOptions)test(`${theme.name}主题首页通过 WCAG 2.2 A/AA 自动扫描`,async({page},testInfo)=>{
  await openDemo(page);await page.goto('/#settings');await page.getByRole('button',{name:new RegExp(theme.name)}).click();await page.goto('/#today');await checkA11y(page,testInfo,theme.id)
})

test('跳过导航、页面焦点和弹窗焦点约束可用',async({page})=>{
  await openDemo(page)
  const skip=page.getByRole('link',{name:'跳到主要内容'})
  await skip.focus();await expect(skip).toBeVisible();await page.keyboard.press('Enter')
  await expect(page.getByRole('main')).toBeFocused()
  const guide=page.getByRole('button',{name:'查看演示指引'});await guide.focus();await page.keyboard.press('Enter')
  const dialog=page.getByRole('dialog',{name:'鹊信 Demo · 从这里开始'});await expect(dialog).toHaveAttribute('aria-modal','true');await expect(dialog.locator(':focus')).toBeVisible()
  const focusables=dialog.locator('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'),count=await focusables.count()
  for(let index=0;index<count+1;index++)await page.keyboard.press('Tab')
  await expect(dialog.locator(':focus')).toBeVisible();await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(guide).toBeFocused()
  await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:/回忆/}).click();await expect(page.getByRole('main')).toBeFocused()
})

test('减少动态、文本间距和强制色彩模式保留关键操作',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce',forcedColors:'active'});await openDemo(page)
  await page.goto('/#nest');const sprite=page.locator('.life-pet-sprite');await expect(sprite).toBeVisible();expect(await sprite.evaluate(el=>getComputedStyle(el).animationDuration)).toMatch(/^(0s|0\.00001s)$/)
  await page.addStyleTag({content:'*{line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important}p{margin-bottom:2em!important}'})
  await expect(page.getByRole('button',{name:'摸摸',exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1)).toBe(true)
})

test('手机模拟软键盘缩小可视区域后表单仍可填写和提交',async({page})=>{
  await page.setViewportSize({width:390,height:430});await openDemo(page);await page.goto('/#memories');await page.getByRole('button',{name:'写一条回忆',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'写下值得记住的事'});await dialog.getByLabel('标题',{exact:true}).fill('软键盘测试');await dialog.getByLabel('内容',{exact:true}).fill('输入时页面仍能滚动到保存按钮。')
  const save=dialog.getByRole('button',{name:'保存记录'});await save.scrollIntoViewIfNeeded();await expect(save).toBeInViewport();await save.click();await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('200% 等效视口和 320px 回流不产生页面横向裁切',async({page})=>{
  await page.setViewportSize({width:640,height:800});await openDemo(page)
  for(const width of [640,320]){
    await page.setViewportSize({width,height:800})
    for(const route of routes){await page.goto('/#'+route);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1)).toBe(true)}
  }
})

test('青鸟统一聊天在未配置模型时仍可键盘浏览并通过自动扫描',async({page},testInfo)=>{
  await openDemo(page);const open=page.getByRole('button',{name:/展开青鸟助手|打开青鸟助手/});if(await open.isVisible())await open.click();const assistant=page.getByRole('complementary',{name:'青鸟助手'});await expect(assistant.getByLabel('给青鸟输入指令')).toBeVisible();await assistant.getByLabel('给青鸟输入指令').focus();await expect(assistant.getByLabel('给青鸟输入指令')).toBeFocused();await checkA11y(page,testInfo,'assistant-conversation')
})
