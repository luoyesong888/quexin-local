import {test,expect} from '@playwright/test'
import {queuedRecord,changeQueuedRecord,putRow} from '../privacy/support'
for(const change of ['private','delete'] as const)test(`页面关闭后 Worker 拦截旧队列：${change}`,async({page,context})=>{
 const api='http://127.0.0.1:4393/v1',fixture=await queuedRecord(page,context,api,true)
 await page.evaluate(async()=>navigator.serviceWorker.ready);const worker=context.serviceWorkers()[0];expect(worker).toBeTruthy()
 await changeQueuedRecord(page,fixture.title,change)
 // Restore the stale queue deliberately; the worker must re-check persisted data.
 await putRow(page,fixture.row);await page.close();await context.setOffline(false);await worker.evaluate('runBackgroundSync()')
 const response=(await (await context.request.get(api+`/spaces/${fixture.spaceId}/changes?cursor=0`)).json()).data
 expect(JSON.stringify(response)).not.toContain('PRIVATE_PENDING_BODY')
 const rows=await worker.evaluate('loadSyncWorkspaces()');expect(rows.find((r:any)=>r.id===fixture.row.id).queue).toHaveLength(0)
})

test('无法读取账号资料库时 Worker 暂停，不能盲发旧正文',async({page,context})=>{
 const api='http://127.0.0.1:4393/v1',fixture=await queuedRecord(page,context,api,true),worker=context.serviceWorkers()[0]
 await page.close()
 await worker.evaluate(userId=>new Promise<void>((resolve,reject)=>{const r=indexedDB.deleteDatabase('quexin-web-account-'+userId);r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error)}),fixture.userId)
 await context.setOffline(false)
 const result=await worker.evaluate('runBackgroundSync().then(()=>"sent",error=>String(error))');expect(result).not.toBe('sent')
 const data=(await (await context.request.get(api+`/spaces/${fixture.spaceId}/changes?cursor=0`)).json()).data;expect(JSON.stringify(data)).not.toContain('PRIVATE_PENDING_BODY')
})
