import {test,expect,type Page} from '@playwright/test'

const routes={today:'今日',import:'导入',memories:'回忆',planner:'计划',care:'关怀',nest:'鹊巢',create:'创作',settings:'系统'} as const
async function demo(page:Page){await page.goto('/');await page.getByRole('button',{name:'先用虚构资料体验完整功能'}).click();await expect(page.locator('.app-shell')).toBeVisible()}
async function noHorizontalCrop(page:Page){const widths=await page.evaluate(()=>({document:[document.documentElement.scrollWidth,document.documentElement.clientWidth],main:[document.querySelector('main')?.scrollWidth??0,document.querySelector('main')?.clientWidth??0]}));expect(widths.document[0]).toBeLessThanOrEqual(widths.document[1]+1);expect(widths.main[0]).toBeLessThanOrEqual(widths.main[1]+1)}

test('八页面、创建与备份下载在当前浏览器可用',async({page},testInfo)=>{
  await demo(page)
  const mobile=/pixel|iphone/.test(testInfo.project.name)
  for(const [route,title] of Object.entries(routes)){
    await page.goto('/#'+route);await expect(mobile?page.getByRole('main'):page.locator('#page-title')).toBeVisible();await expect(page).toHaveTitle(new RegExp(`鹊信 · ${title}`));await noHorizontalCrop(page)
  }
  await page.goto('/#memories');await page.getByRole('button',{name:'写一条回忆',exact:true}).click();const dialog=page.getByRole('dialog',{name:'写下值得记住的事'});await dialog.getByLabel('标题',{exact:true}).fill(`兼容性记录-${testInfo.project.name}`);await dialog.getByLabel('内容',{exact:true}).fill('这条记录用于验证不同浏览器的创建、保存和刷新。');await dialog.getByRole('button',{name:'保存记录'}).click();await expect(dialog).toHaveCount(0);await expect(page.getByRole('main')).toContainText(`兼容性记录-${testInfo.project.name}`);await page.reload();await expect(page.getByRole('main')).toContainText(`兼容性记录-${testInfo.project.name}`)
  await page.goto('/#settings');await page.getByRole('button',{name:'数据与备份',exact:true}).click();const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'导出完整备份'}).click();const download=await downloading,body=JSON.parse(await (await import('node:fs/promises')).readFile((await download.path())!,'utf8'));expect(body.records.some((item:any)=>item.title===`兼容性记录-${testInfo.project.name}`)).toBe(true)
  await page.screenshot({path:testInfo.outputPath('compat.png'),fullPage:true,animations:'disabled'})
})

test('移动端横竖屏、软键盘和触控目标可用',async({page},testInfo)=>{
  test.skip(!/pixel|iphone/.test(testInfo.project.name),'仅移动设备项目运行')
  await demo(page);await page.setViewportSize({width:844,height:390})
  for(const route of Object.keys(routes)){await page.goto('/#'+route);await expect(page.locator('.app-shell')).toBeVisible();await noHorizontalCrop(page)}
  await page.setViewportSize({width:390,height:430});await page.goto('/#create');await page.getByRole('button',{name:'写一封信',exact:true}).click();const dialog=page.getByRole('dialog',{name:'新的信件'});await dialog.getByLabel('想说的话').fill('模拟软键盘出现后，编辑器仍然可滚动和保存。');const save=dialog.getByRole('button',{name:'保存这份心意'});await save.scrollIntoViewIfNeeded();await expect(save).toBeInViewport()
  const small=await page.locator('button:visible').evaluateAll(buttons=>buttons.map(button=>{const rect=button.getBoundingClientRect();return{text:(button.getAttribute('aria-label')||button.textContent||'').trim().slice(0,40),width:rect.width,height:rect.height}}).filter(item=>item.width<24||item.height<24));expect(small).toEqual([])
  await save.click();await expect(page.getByRole('dialog')).toHaveCount(0);await page.screenshot({path:testInfo.outputPath('mobile-keyboard.png'),animations:'disabled'})
})
