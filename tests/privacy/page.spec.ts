import {test,expect} from '@playwright/test'
import {queuedRecord,changeQueuedRecord,putRow} from './support'
for(const change of ['private','delete'] as const)test(`前台联网重试拦截旧队列：${change}`,async({page,context})=>{
 const api='http://127.0.0.1:5793/v1',fixture=await queuedRecord(page,context,api)
 await changeQueuedRecord(page,fixture.title,change);await putRow(page,fixture.row)
 await context.setOffline(false);await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:/系统/}).click();await page.getByRole('button',{name:'空间与功能',exact:true}).click()
 const lab=page.getByTestId('sync-lab');await lab.getByRole('button',{name:'立即同步',exact:true}).click();await expect(lab.getByText(/离线队列 0 项/)).toBeVisible()
 const response=(await (await context.request.get(api+`/spaces/${fixture.spaceId}/changes?cursor=0`)).json()).data
 expect(JSON.stringify(response)).not.toContain('PRIVATE_PENDING_BODY')
 await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:/回忆/}).click()
 if(change==='private'){await expect(page.getByRole('main')).toContainText(fixture.title);await expect(page.getByRole('main')).toContainText('仅自己')}
 else await expect(page.getByRole('main')).not.toContainText(fixture.title)
})

test('远端删除标记不会删除本机已转为私人的副本',async({page,context})=>{
 const api='http://127.0.0.1:5793/v1',fixture=await queuedRecord(page,context,api)
 // Simulate a previously accepted request whose acknowledgement was lost.
 const response=await context.request.post(api+`/spaces/${fixture.spaceId}/sync`,{data:{commands:fixture.row.queue.map((entry:any)=>entry.command)}});expect(response.ok()).toBe(true)
 await changeQueuedRecord(page,fixture.title,'private');await context.setOffline(false)
 await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:/系统/}).click();await page.getByRole('button',{name:'空间与功能',exact:true}).click()
 const lab=page.getByTestId('sync-lab');await lab.getByRole('button',{name:'只拉取变化',exact:true}).click();await expect(page.getByRole('status').filter({hasText:/已拉取/})).toBeVisible()
 await lab.getByRole('button',{name:'立即同步',exact:true}).click()
 await expect.poll(async()=>{const data=(await (await context.request.get(api+`/spaces/${fixture.spaceId}/changes?cursor=0`)).json()).data;return data.records.filter((r:any)=>!r.deletedAt&&r.visibility==='shared'&&r.title===fixture.title).length}).toBe(0)
 await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:/回忆/}).click();await expect(page.getByRole('main')).toContainText(fixture.title);await expect(page.getByRole('main')).toContainText('仅自己')
})

test('服务端私有记录拉取后仍为私人，不重新上传或误删除',async({page,context})=>{
 const api='http://127.0.0.1:5793/v1',email=`private-server-${crypto.randomUUID()}@example.test`
 await context.request.post(api+'/auth/register',{data:{email,password:'private-server-password',displayName:'私人资料甲'}})
 const mail=(await (await context.request.get(api+`/dev/mailbox/latest?email=${email}&purpose=verify_email`)).json()).data
 await context.request.post(api+'/auth/email/verify',{data:{token:mail.token}})
 const space=(await (await context.request.post(api+'/spaces',{data:{name:'私人来源空间',selfDisplayName:'私人资料甲'}})).json()).data.space
 await context.request.post(api+`/spaces/${space.id}/sync`,{data:{commands:[{commandId:crypto.randomUUID(),entity:'record',entityId:'server-private',operation:'create',expectedRevision:null,clientTime:new Date().toISOString(),payload:{id:'server-private',title:'服务端私人记录',body:'仅作者可见',source:'私有来源',kind:'回忆',status:'confirmed',date:'2026-10-30',visibility:'private'}}]}})
 await page.goto('/#settings');await page.getByRole('button',{name:'空间与功能',exact:true}).click()
 const lab=page.getByTestId('sync-lab');await lab.getByRole('button',{name:'立即同步',exact:true}).click();await expect(lab.getByText(/离线队列 0 项/)).toBeVisible()
 await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:/回忆/}).click();await expect(page.getByRole('main')).toContainText('服务端私人记录');await expect(page.getByRole('main')).toContainText('仅自己')
 await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:/系统/}).click();await page.getByRole('button',{name:'空间与功能',exact:true}).click();await lab.getByRole('button',{name:'立即同步',exact:true}).click()
 const data=(await (await context.request.get(api+`/spaces/${space.id}/changes?cursor=0`)).json()).data
 expect(data.records.find((r:any)=>r.id==='server-private')).toMatchObject({visibility:'private',deletedAt:null,revision:1})
})
