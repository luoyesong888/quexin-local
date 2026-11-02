import {expect,type BrowserContext,type Page} from '@playwright/test'
export async function readRows(page:Page){return page.evaluate(async()=>new Promise<any[]>((resolve,reject)=>{const r=indexedDB.open('quexin-sync-state',1);r.onsuccess=()=>{const db=r.result,tx=db.transaction('workspaces','readonly'),get=tx.objectStore('workspaces').getAll();get.onsuccess=()=>resolve(get.result);tx.oncomplete=()=>db.close();tx.onerror=()=>reject(tx.error)};r.onerror=()=>reject(r.error)}))}
export async function putRow(page:Page,row:any){await page.evaluate(row=>new Promise<void>((resolve,reject)=>{const r=indexedDB.open('quexin-sync-state',1);r.onsuccess=()=>{const db=r.result,tx=db.transaction('workspaces','readwrite');tx.objectStore('workspaces').put(row);tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)};r.onerror=()=>reject(r.error)}),row)}
export async function queuedRecord(page:Page,context:BrowserContext,api:string,withWorker=false){
 const email=`privacy-${crypto.randomUUID()}@example.test`,password='privacy-password-2026',title='离线等待确认的私人故事'
 const registration=await context.request.post(api+'/auth/register',{data:{email,password,displayName:'隐私甲'}});expect(registration.status()).toBe(201);const userId=(await registration.json()).data.userId
 const mail=(await (await context.request.get(api+`/dev/mailbox/latest?email=${email}&purpose=verify_email`)).json()).data
 await context.request.post(api+'/auth/email/verify',{data:{token:mail.token}})
 const space=(await (await context.request.post(api+'/spaces',{data:{name:'隐私验收',selfDisplayName:'隐私甲'}})).json()).data.space
 await page.goto('/#settings');await page.getByRole('button',{name:'空间与功能',exact:true}).click();await expect(page.getByTestId('sync-lab').getByText('隐私验收',{exact:true})).toBeVisible()
 if(withWorker)await page.evaluate(async()=>navigator.serviceWorker.ready.then(()=>true))
 await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:/回忆/}).click();await context.setOffline(true)
 await page.getByRole('button',{name:'写一条回忆',exact:true}).first().click();await page.getByRole('textbox',{name:'标题',exact:true}).fill(title);await page.getByRole('textbox',{name:'内容',exact:true}).fill('PRIVATE_PENDING_BODY');await page.getByRole('button',{name:'保存记录',exact:true}).click()
 await expect.poll(async()=>(await readRows(page)).some(row=>row.queue.some((entry:any)=>entry.command.payload?.body==='PRIVATE_PENDING_BODY'))).toBe(true)
 const row=(await readRows(page)).find(row=>row.id===`formal:${userId}:${space.id}`)
 return {title,row,spaceId:space.id,userId}
}
export async function changeQueuedRecord(page:Page,title:string,change:'private'|'delete'){
 await page.getByRole('main').getByRole('button',{name:new RegExp(title)}).click()
 if(change==='delete'){await page.getByRole('button',{name:'删除记录',exact:true}).click();await page.getByRole('button',{name:'确认删除',exact:true}).click()}
 else{await page.getByRole('button',{name:'编辑记录',exact:true}).click();await page.getByRole('checkbox',{name:/包含私人或敏感内容/}).check();await page.getByRole('button',{name:'保存记录',exact:true}).click();await page.getByRole('button',{name:'关闭弹窗',exact:true}).click()}
 await expect(page.locator('.topbar .top-status').first()).toContainText('IndexedDB 已就绪')
}
