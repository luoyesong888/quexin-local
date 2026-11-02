import {test,expect} from '@playwright/test'
import {readFile} from 'node:fs/promises'

test('慢写入期间连续照顾宠物不丢操作，也不产生自己的版本冲突',async({page})=>{
 await page.goto('/#nest');await page.getByRole('button',{name:'先用虚构资料体验完整功能'}).click();await expect(page.locator('.topbar .top-status').first()).toContainText('IndexedDB 已就绪')
 const original=Number((await page.locator('.life-feathers').innerText()).match(/\d+/)![0])
 await page.evaluate(async()=>{
  const modulePath='/src/repository.ts',module=await import(/* @vite-ignore */ modulePath),repo=module.repositoryFor(''),apply=repo.applyPatch.bind(repo)
  let held=false;const state=window as unknown as {releaseWrite:()=>void;writeHeld:boolean}
  repo.applyPatch=async(patch:unknown)=>{if(!held){held=true;state.writeHeld=true;await new Promise<void>(r=>state.releaseWrite=r)}return apply(patch)}
 })
 await page.getByRole('button',{name:'摸摸',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as unknown as {writeHeld:boolean}).writeHeld)).toBe(true)
 await page.getByRole('button',{name:'喂点心',exact:true}).click();await expect(page.locator('.life-feathers')).toContainText(String(original+5))
 await page.evaluate(()=>(window as unknown as {releaseWrite:()=>void}).releaseWrite())
 await expect(page.locator('.topbar .top-status').first()).toContainText('IndexedDB 已就绪');await expect(page.getByRole('alert')).toHaveCount(0)
 await expect(page.locator('.life-feathers')).toContainText(String(original+5));await page.reload();await expect(page.locator('.life-feathers')).toContainText(String(original+5))
 await expect(page.locator('.life-pet-sprite')).toHaveClass(/pose-eat/)
})

test('浏览器备份可恢复到另一个空白浏览器，包含原文、私人草稿与宠物',async({page,browser})=>{
 await page.goto('/#settings');await page.getByRole('button',{name:'先用虚构资料体验完整功能'}).click()
 await page.getByRole('button',{name:/星河来信/}).click();await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:/关怀/}).click()
 await page.getByRole('textbox',{name:'发生了什么？我希望被怎样对待？'}).fill('恢复验收的私人草稿');await page.getByRole('button',{name:'保存私人草稿',exact:true}).click()
 await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:/系统/}).click();await page.getByRole('button',{name:'数据与备份',exact:true}).click()
 const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'导出完整备份'}).click();const download=await downloading,path=(await download.path())!,backup=JSON.parse(await readFile(path,'utf8'))
 expect(backup.care.draft).toBe('恢复验收的私人草稿');expect(backup.settings.theme).toBe('cosmos')
 const context=await browser.newContext(),restored=await context.newPage()
 try{
  await restored.goto('/#settings');await restored.getByLabel('怎么称呼你').fill('恢复甲');await restored.getByLabel('怎么称呼对方').fill('恢复乙');await restored.getByRole('button',{name:'创建我们的空间'}).click()
  await restored.getByRole('button',{name:'数据与备份',exact:true}).click();await restored.getByLabel('选择 JSON 备份文件').setInputFiles(path)
  await expect(restored.getByRole('dialog',{name:'恢复这份备份？'})).toBeVisible();await expect(restored.locator('.app-shell')).toHaveAttribute('data-theme','paper')
  await restored.getByRole('button',{name:'确认恢复'}).click();await expect(restored.locator('.app-shell')).toHaveAttribute('data-theme','cosmos');await expect(restored.locator('.topbar .top-status').first()).toContainText('IndexedDB 已就绪')
  await restored.reload();await expect(restored.locator('.app-shell')).toHaveAttribute('data-theme','cosmos')
  await restored.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:/关怀/}).click();await expect(restored.getByRole('textbox',{name:'发生了什么？我希望被怎样对待？'})).toHaveValue('恢复验收的私人草稿')
  await restored.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:/系统/}).click();await restored.getByRole('button',{name:'数据与备份',exact:true}).click()
  const redownloading=restored.waitForEvent('download');await restored.getByRole('button',{name:'导出完整备份'}).click();const again=JSON.parse(await readFile((await (await redownloading).path())!,'utf8'))
  const byId=(items:Array<{id:string}>)=>[...items].sort((a,b)=>a.id.localeCompare(b.id))
  expect(byId(again.records)).toEqual(byId(backup.records));expect(byId(again.plans)).toEqual(byId(backup.plans));expect(byId(again.journals)).toEqual(byId(backup.journals));expect(again.pet).toEqual(backup.pet)
 }finally{await context.close()}
})
