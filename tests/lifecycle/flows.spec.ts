import {test,expect,type Browser,type BrowserContext} from '@playwright/test'
import {createHash} from 'node:crypto'
import sharp from 'sharp'
const api='http://127.0.0.1:5893/v1',password='lifecycle-browser-password'
async function account(context:BrowserContext,name:string){const email=`lifecycle-${crypto.randomUUID()}@example.test`,r=await context.request.post(api+'/auth/register',{data:{email,password,displayName:name}});expect(r.status()).toBe(201);const user=(await r.json()).data;const mail=(await (await context.request.get(api+`/dev/mailbox/latest?email=${email}&purpose=verify_email`)).json()).data;await context.request.post(api+'/auth/email/verify',{data:{token:mail.token}});return{...user,email}}
async function couple(browser:Browser){const a=await browser.newContext(),b=await browser.newContext();const owner=await account(a,'作者甲'),partner=await account(b,'伴侣乙');const space=(await (await a.request.post(api+'/spaces',{data:{name:'双人验收空间',selfDisplayName:'作者甲'}})).json()).data.space;const invite=(await (await a.request.post(api+`/spaces/${space.id}/invites`,{data:{ttlHours:1}})).json()).data;await b.request.post(api+`/invites/${invite.code}/accept`,{data:{displayName:'伴侣乙'}});return{a,b,owner,partner,space,close:async()=>{await a.close();await b.close()}}}
async function record(context:BrowserContext,spaceId:string,id:string,title:string,body:string,mediaId?:string){const r=await context.request.post(api+`/spaces/${spaceId}/sync`,{data:{commands:[{commandId:crypto.randomUUID(),entity:'record',entityId:id,operation:'create',expectedRevision:null,payload:{id,title,body,kind:'回忆',date:'2026-10-30',source:'验收输入',status:'confirmed',visibility:'shared',...(mediaId?{mediaId,mediaScope:'shared'}:{})},clientTime:new Date().toISOString()}]}});expect(r.ok()).toBe(true)}
async function photo(context:BrowserContext,spaceId:string){const bytes=await sharp({create:{width:16,height:16,channels:3,background:'#eeddbb'}}).png().toBuffer();const grant=(await (await context.request.post(api+`/spaces/${spaceId}/uploads`,{data:{filename:'分享照片.png',contentType:'image/png',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),scope:'shared',entityType:'record',entityId:'owner-photo'}})).json()).data;expect((await context.request.put('http://127.0.0.1:5893'+grant.uploadUrl,{headers:{'content-type':'image/png'},data:bytes})).status()).toBe(201);return grant.mediaId}

test('撤回阻断另一账号的新读取，旧原图缩略图与数据包失效',async({browser},testInfo)=>{
 const f=await couple(browser)
 try{
  const mediaId=await photo(f.a,f.space.id);await record(f.a,f.space.id,'owner-photo','共享照片记录','WITHDRAW_SECRET',mediaId)
  const job=(await (await f.b.request.post(api+`/spaces/${f.space.id}/exports`)).json()).data;expect((await f.b.request.get('http://127.0.0.1:5893'+job.downloadUrl)).status()).toBe(200)
  expect((await f.b.request.post(api+`/spaces/${f.space.id}/withdraw`,{data:{entity:'record',entityId:'owner-photo',revision:1}})).status()).toBe(403)
  const p=await f.a.newPage();await p.goto('/#settings');await p.getByRole('button',{name:'空间与功能',exact:true}).click()
  const panel=p.getByRole('region',{name:'共享与账号管理'}),row=panel.locator('.sharing-row').filter({hasText:'共享照片记录'})
  await row.getByRole('button',{name:'撤回共享',exact:true}).click();await p.getByRole('dialog').getByRole('button',{name:'确认撤回',exact:true}).click();await expect(row).toContainText('仅自己 · 服务端已确认')
  await panel.screenshot({path:testInfo.outputPath('sharing-withdrawn.png')})
  expect((await f.b.request.get(api+`/media/${mediaId}`)).status()).toBe(404);expect((await f.b.request.get(api+`/media/${mediaId}?variant=thumbnail`)).status()).toBe(404);expect((await f.a.request.get(api+`/media/${mediaId}`)).status()).toBe(200)
  expect([404,410]).toContain((await f.b.request.get('http://127.0.0.1:5893'+job.downloadUrl)).status())
  const changes=(await (await f.b.request.get(api+`/spaces/${f.space.id}/changes?cursor=0`)).json()).data;expect(JSON.stringify(changes)).not.toContain('WITHDRAW_SECRET');expect(changes.events.some((e:any)=>e.operation==='delete'&&e.entityId==='owner-photo')).toBe(true)
  const late=await f.a.request.post(api+`/spaces/${f.space.id}/sync`,{data:{commands:[{commandId:crypto.randomUUID(),entity:'record',entityId:'owner-photo',operation:'update',expectedRevision:2,payload:{title:'旧设备重新公开',visibility:'shared'},clientTime:new Date().toISOString()}]}});expect(late.status()).toBe(409)
 }finally{await f.close()}
})

test('单独撤回照片时关联记录也撤回，其他成员不能撤回上传者的照片',async({browser})=>{
 const f=await couple(browser)
 try{const id=await photo(f.a,f.space.id);await record(f.a,f.space.id,'owner-photo','照片关联','PHOTO_ONLY_SECRET',id)
  expect([403,404]).toContain((await f.b.request.post(api+`/media/${id}/withdraw`)).status());expect((await f.a.request.post(api+`/media/${id}/withdraw`)).status()).toBe(200)
  expect((await f.b.request.get(api+`/media/${id}`)).status()).toBe(404);expect(JSON.stringify((await (await f.b.request.get(api+`/spaces/${f.space.id}/changes?cursor=0`)).json()).data)).not.toContain('PHOTO_ONLY_SECRET')
 }finally{await f.close()}
})

test('撤回已生效但应答丢失时显示失败，刷新后取得真实服务端状态',async({browser})=>{
 const f=await couple(browser)
 try{
  await record(f.a,f.space.id,'lost-reply','应答丢失的撤回','LOST_REPLY_SECRET')
  const page=await f.a.newPage();await page.goto('/#settings');await page.getByRole('button',{name:'空间与功能',exact:true}).click()
  await page.route('**/formal/v1/spaces/*/withdraw',async route=>{const response=await route.fetch();expect(response.status()).toBe(200);await route.abort('failed')})
  const panel=page.getByRole('region',{name:'共享与账号管理'}),row=panel.locator('.sharing-row').filter({hasText:'应答丢失的撤回'})
  await row.getByRole('button',{name:'撤回共享',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认撤回',exact:true}).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();await page.getByRole('button',{name:'关闭弹窗'}).click();await page.unroute('**/formal/v1/spaces/*/withdraw')
  await panel.getByRole('button',{name:'刷新共享状态'}).click();await expect(row).toContainText('仅自己 · 服务端已确认')
  const data=(await (await f.b.request.get(api+`/spaces/${f.space.id}/changes?cursor=0`)).json()).data;expect(JSON.stringify(data)).not.toContain('LOST_REPLY_SECRET')
 }finally{await f.close()}
})

test('退出空间保留本机私人归档，旧贡献撤回，新空间不自动重发',async({browser})=>{
 const f=await couple(browser)
 try{
  await record(f.a,f.space.id,'owner-story','作者的旧故事','LEAVE_OWNER_SECRET');await record(f.b,f.space.id,'partner-story','留下的故事','PARTNER_KEEP')
  const oldJob=(await (await f.b.request.post(api+`/spaces/${f.space.id}/exports`)).json()).data
  const page=await f.a.newPage();await page.goto('/#settings');await page.getByRole('button',{name:'空间与功能',exact:true}).click();await page.getByTestId('sync-lab').getByRole('button',{name:'立即同步',exact:true}).click()
  await page.getByRole('region',{name:'共享与账号管理'}).getByRole('button',{name:'退出共同空间',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'退出共同空间'});await expect(dialog.getByRole('button',{name:'确认退出空间'})).toBeDisabled();await dialog.getByLabel('操作确认文字').fill('退出 双人验收空间');await dialog.getByRole('button',{name:'确认退出空间'}).click()
  await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByTestId('sync-lab').getByRole('button',{name:'创建空间',exact:true})).toBeVisible()
  const remaining=(await (await f.b.request.get(api+'/spaces/current')).json()).data;expect(remaining.members).toHaveLength(1);expect(remaining.members[0].role).toBe('owner')
  expect((await f.a.request.get(api+`/spaces/${f.space.id}/changes?cursor=0`)).status()).toBe(403);expect([403,404,410]).toContain((await f.b.request.get('http://127.0.0.1:5893'+oldJob.downloadUrl)).status())
  const changes=(await (await f.b.request.get(api+`/spaces/${f.space.id}/changes?cursor=0`)).json()).data;expect(JSON.stringify(changes)).not.toContain('LEAVE_OWNER_SECRET');expect(JSON.stringify(changes)).toContain('PARTNER_KEEP')
  await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:/回忆/}).click();await expect(page.getByRole('main')).toContainText('作者的旧故事');await expect(page.getByRole('main').getByText('仅自己')).toHaveCount(2)
  await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:/系统/}).click();await page.getByRole('button',{name:'空间与功能',exact:true}).click();await page.getByTestId('sync-lab').getByRole('button',{name:'创建空间',exact:true}).click()
  let next:any
  await expect.poll(async()=>{const data=(await (await f.a.request.get(api+'/spaces/current')).json()).data;next=data?.space;return next?.id??''}).not.toBe('')
  expect(next.id).not.toBe(f.space.id)
  await page.getByTestId('sync-lab').getByRole('button',{name:'立即同步',exact:true}).click();const nextData=(await (await f.a.request.get(api+`/spaces/${next.id}/changes?cursor=0`)).json()).data;expect(nextData.records).toHaveLength(0)
 }finally{await f.close()}
})

test('注销需要当前密码，撤销其他会话，另一成员及其资料保留',async({browser},testInfo)=>{
 const f=await couple(browser),other=await browser.newContext()
 try{
  await record(f.a,f.space.id,'deleted-owner','即将注销的资料','DELETE_ACCOUNT_SECRET');await record(f.b,f.space.id,'keep-partner','伴侣自己的资料','SURVIVOR_DATA')
  await other.request.post(api+'/auth/login',{data:{email:f.owner.email,password}})
  const page=await f.a.newPage();await page.setViewportSize({width:390,height:844});await page.goto('/#settings');await page.getByRole('button',{name:'空间与功能',exact:true}).click();await page.getByRole('region',{name:'共享与账号管理'}).getByRole('button',{name:'注销账号',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'注销账号'});await dialog.getByLabel('操作确认文字').fill('注销我的账号');await dialog.getByLabel('注销确认密码').fill('wrong-password');await dialog.getByRole('button',{name:'确认注销账号'}).click();await expect(dialog.getByRole('alert')).toContainText('密码不正确');expect((await f.a.request.get(api+'/session')).status()).toBe(200)
  await page.screenshot({path:testInfo.outputPath('mobile-close-account.png')})
  await dialog.getByLabel('注销确认密码').fill(password);await dialog.getByRole('button',{name:'确认注销账号'}).click();await expect(page.getByRole('heading',{name:'先介绍一下你们'})).toBeVisible()
  expect((await other.request.get(api+'/session')).status()).toBe(401);expect((await f.a.request.post(api+'/auth/login',{data:{email:f.owner.email,password}})).status()).toBe(401)
  const remaining=(await (await f.b.request.get(api+'/spaces/current')).json()).data;expect(remaining.members[0].role).toBe('owner');const data=(await (await f.b.request.get(api+`/spaces/${f.space.id}/changes?cursor=0`)).json()).data;expect(JSON.stringify(data)).toContain('SURVIVOR_DATA');expect(JSON.stringify(data)).not.toContain('DELETE_ACCOUNT_SECRET')
 }finally{await other.close();await f.close()}
})
