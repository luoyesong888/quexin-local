import { expect,test } from '@playwright/test'
import { z } from 'zod'

const envelope=z.union([z.object({ok:z.literal(true),data:z.unknown(),requestId:z.string()}),z.object({ok:z.literal(false),error:z.object({code:z.string(),message:z.string(),requestId:z.string()})})])

test('PWA 页面关闭后由 Service Worker 提交离线队列',async({page,context,playwright})=>{
  const email='pwa-owner@example.test',password='pwa-owner-password-2026'
  await page.goto('/#settings')
  await page.getByRole('button',{name:'先用虚构资料体验完整功能'}).click()
  await page.getByRole('button',{name:'空间与功能'}).click()
  const lab=page.getByTestId('sync-lab')
  await lab.getByLabel('邮箱').fill(email)
  await lab.getByLabel('你的称呼').fill('后台甲')
  await lab.getByLabel('密码').fill(password)
  await lab.getByRole('button',{name:'注册并登录'}).click()
  await lab.getByRole('button',{name:'使用开发邮件箱完成验证'}).click()
  await lab.getByRole('button',{name:'创建空间'}).click()
  await expect(lab.getByText(/离线队列 0 项/)).toBeVisible()
  const workerReady=await page.evaluate(async()=>Boolean((await navigator.serviceWorker.ready).active))
  expect(workerReady).toBe(true)

  const api=await playwright.request.newContext({baseURL:'http://127.0.0.1:4393',extraHTTPHeaders:{'content-type':'application/json'}})
  const login=envelope.parse(await (await api.post('/v1/auth/login',{data:{email,password}})).json());expect(login.ok).toBe(true)
  const current=envelope.parse(await (await api.get('/v1/spaces/current')).json());expect(current.ok).toBe(true)
  if(!current.ok||!current.data||typeof current.data!=='object')throw new Error('没有测试空间')
  const spaceId=(current.data as {space:{id:string}}).space.id

  await page.getByRole('button',{name:/03 回忆/}).click()
  await context.setOffline(true)
  await page.getByRole('button',{name:/雨天，也有好天气/}).first().click()
  await page.getByRole('button',{name:'编辑记录'}).click()
  await page.getByLabel('标题').fill('页面关闭后同步的咖啡回忆')
  await page.getByRole('textbox',{name:'内容',exact:true}).fill('这条内容先离线入队，再关闭页面，由 Service Worker 提交。')
  await page.getByRole('button',{name:'保存记录'}).click()
  await expect.poll(()=>page.evaluate(async()=>new Promise<number>((resolve,reject)=>{const request=indexedDB.open('quexin-sync-state',1);request.onsuccess=()=>{const database=request.result,transaction=database.transaction('workspaces','readonly'),all=transaction.objectStore('workspaces').getAll();all.onsuccess=()=>{database.close();resolve(all.result.reduce((sum,row)=>sum+(row.queue?.length??0),0))};all.onerror=()=>reject(all.error)};request.onerror=()=>reject(request.error)}))).toBeGreaterThan(0)
  const worker=context.serviceWorkers()[0];expect(worker).toBeTruthy()
  await page.close()
  await context.setOffline(false)
  await worker.evaluate('runBackgroundSync()')

  await expect.poll(async()=>{
    const response=await api.get(`/v1/spaces/${spaceId}/changes?cursor=0`),parsed=envelope.parse(await response.json())
    if(!parsed.ok||!parsed.data||typeof parsed.data!=='object')return''
    const records=(parsed.data as {records:Array<{id:string;title:string}>}).records
    return records.find(item=>item.id==='memory-cafe')?.title??''
  },{timeout:20_000}).toBe('页面关闭后同步的咖啡回忆')
  await api.dispose()
})
