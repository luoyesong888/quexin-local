import { expect,test,type APIRequestContext,type APIResponse,type Playwright } from '@playwright/test'
import { z } from 'zod'

const apiOrigin='http://127.0.0.1:4293'
const envelope=<T extends z.ZodTypeAny>(schema:T)=>z.union([z.object({ok:z.literal(true),data:schema,requestId:z.string()}),z.object({ok:z.literal(false),error:z.object({code:z.string(),message:z.string(),requestId:z.string()})})])
async function dataOf<T extends z.ZodTypeAny>(response:APIResponse,schema:T):Promise<z.infer<T>>{
  const parsed=envelope(schema).parse(await response.json())
  expect(parsed.ok).toBe(true)
  if(!parsed.ok)throw new Error(parsed.error.message)
  return parsed.data
}
async function apiContext(playwright:Playwright):Promise<APIRequestContext>{return playwright.request.newContext({baseURL:apiOrigin,extraHTTPHeaders:{'content-type':'application/json'}})}

test('离线队列刷新恢复，冲突双版本可保留本机并重试',async({page,playwright})=>{
  const ownerEmail='e2e-owner@example.test',ownerPassword='e2e-owner-password-2026'
  let spaceId=''
  await test.step('载入示例并创建正式空间',async()=>{
    await page.goto('/#settings')
    await page.getByRole('button',{name:'先用虚构资料体验完整功能'}).click()
    await page.getByRole('button',{name:'空间与功能'}).click()
    const lab=page.getByTestId('sync-lab')
    await lab.getByLabel('邮箱').fill(ownerEmail)
    await lab.getByLabel('你的称呼').fill('离线甲')
    await lab.getByLabel('密码').fill(ownerPassword)
    await lab.getByRole('button',{name:'注册并登录'}).click()
    await lab.getByRole('button',{name:'使用开发邮件箱完成验证'}).click()
    await lab.getByRole('button',{name:'创建空间'}).click()
    await expect(lab.getByText(/离线队列 0 项/)).toBeVisible()
  })

  const owner=await apiContext(playwright),partner=await apiContext(playwright)
  await test.step('伴侣先写入云端 revision 2',async()=>{
    await dataOf(await owner.post('/v1/auth/login',{data:{email:ownerEmail,password:ownerPassword}}),z.object({userId:z.string(),displayName:z.string(),email:z.string(),emailVerified:z.boolean(),sessionId:z.string(),expiresAt:z.string()}))
    const current=await dataOf(await owner.get('/v1/spaces/current'),z.object({space:z.object({id:z.string(),name:z.string(),createdAt:z.string(),revision:z.number()}),members:z.array(z.any())}))
    spaceId=current.space.id
    const invite=await dataOf(await owner.post(`/v1/spaces/${current.space.id}/invites`,{data:{ttlHours:1}}),z.object({code:z.string(),id:z.string(),spaceId:z.string(),status:z.string(),expiresAt:z.string(),createdBy:z.string()}))
    const partnerEmail='e2e-partner@example.test'
    await dataOf(await partner.post('/v1/auth/register',{data:{email:partnerEmail,password:'e2e-partner-password-2026',displayName:'离线乙'}}),z.any())
    const mail=await dataOf(await partner.get(`/v1/dev/mailbox/latest?email=${encodeURIComponent(partnerEmail)}&purpose=verify_email`),z.object({token:z.string(),expiresAt:z.string()}))
    await dataOf(await partner.post('/v1/auth/email/verify',{data:{token:mail.token}}),z.object({verified:z.boolean()}))
    await dataOf(await partner.post(`/v1/invites/${invite.code}/accept`,{data:{displayName:'离线乙'}}),z.any())
    await page.getByRole('button',{name:/03 回忆/}).click()
    const command={commandId:crypto.randomUUID(),entity:'record',entityId:'memory-coast',operation:'update',expectedRevision:1,payload:{id:'memory-coast',title:'伴侣云端版海边回忆',body:'伴侣先保存的云端版本。',date:'2026-10-25',kind:'回忆',source:'E2E 伴侣端',status:'confirmed',visibility:'shared'},clientTime:new Date().toISOString()}
    const synced=await dataOf(await partner.post(`/v1/spaces/${current.space.id}/sync`,{data:{commands:[command]}}),z.object({accepted:z.array(z.object({commandId:z.string(),entityId:z.string(),revision:z.number(),updatedAt:z.string()})),conflicts:z.array(z.any()),cursor:z.string()}))
    expect(synced.accepted[0]?.revision).toBe(2)
  })

  await test.step('接口离线时修改写入队列并跨刷新保留',async()=>{
    await page.route('**/formal/v1/**',route=>route.abort('internetdisconnected'))
    await page.getByRole('button',{name:/把日落装进口袋/}).first().click()
    await page.getByRole('button',{name:'编辑记录'}).click()
    await page.getByLabel('标题').fill('本机离线版海边回忆')
    await page.getByRole('textbox',{name:'内容',exact:true}).fill('API 离线时保存的本机版本，刷新后仍应存在。')
    await page.getByRole('button',{name:'保存记录'}).click()
    await page.getByRole('button',{name:'关闭弹窗'}).click()
    await page.getByRole('button',{name:/08 系统/}).click()
    await page.getByRole('button',{name:'空间与功能'}).click()
    await expect(page.getByText(/离线队列 1 项/)).toBeVisible()
    const inspector=page.getByTestId('sync-queue-inspector')
    await expect(inspector).toContainText('下次重试')
    await inspector.getByText('离线队列诊断').click()
    await expect(inspector).toContainText(/已尝试 [1-9]\d* 次/)
    const downloadPromise=page.waitForEvent('download')
    await inspector.getByRole('button',{name:'导出同步诊断'}).click()
    expect((await downloadPromise).suggestedFilename()).toMatch(/^quexin-sync-diagnostics-\d{4}-\d{2}-\d{2}\.json$/)
    await page.reload()
    await page.getByRole('button',{name:'空间与功能'}).click()
    await expect(page.getByText(/离线队列 1 项/)).toBeVisible()
  })

  await test.step('恢复接口后展示冲突并保留本机版本',async()=>{
    await page.unroute('**/formal/v1/**')
    await page.getByRole('button',{name:'立即同步'}).click()
    await expect(page.getByRole('heading',{name:'版本冲突待确认'})).toBeVisible()
    await expect(page.getByText('本机离线版海边回忆')).toBeVisible()
    await expect(page.getByText('伴侣云端版海边回忆')).toBeVisible()
    await page.getByRole('button',{name:'保留本机并重试'}).click()
    await expect(page.getByRole('heading',{name:'版本冲突待确认'})).toBeHidden()
    await expect(page.getByText(/离线队列 0 项/)).toBeVisible()
    const changes=await dataOf(await partner.get(`/v1/spaces/${spaceId}/changes?cursor=0`),z.object({records:z.array(z.any()),plans:z.array(z.any()),journals:z.array(z.any()),events:z.array(z.any()),nextCursor:z.string()}))
    const coast=changes.records.find((item:{id?:string})=>item.id==='memory-coast')
    expect(coast).toMatchObject({title:'本机离线版海边回忆',revision:3})
  })

  await Promise.all([owner.dispose(),partner.dispose()])
})

test('手机回忆编辑器提供三种照片保存方式',async({page})=>{
  await page.setViewportSize({width:390,height:844})
  await page.goto('/#memories')
  await page.getByRole('button',{name:'先用虚构资料体验完整功能'}).click()
  await page.getByRole('button',{name:'写一条回忆'}).click()
  await expect(page.getByRole('button',{name:'仅当前浏览器'})).toBeVisible()
  await expect(page.getByRole('button',{name:'安全共享'})).toBeVisible()
  await expect(page.getByRole('button',{name:'仅自己'})).toBeVisible()
  await expect(page.getByRole('button',{name:'保存记录'})).toBeVisible()
})

test('两个标签页共享队列且同一修改只提交一次',async({page,context,playwright})=>{
  const email='multitab-owner@example.test',password='multitab-owner-password-2026'
  await page.goto('/#settings')
  await page.getByRole('button',{name:'先用虚构资料体验完整功能'}).click()
  await page.getByRole('button',{name:'空间与功能'}).click()
  const firstLab=page.getByTestId('sync-lab')
  await firstLab.getByLabel('邮箱').fill(email);await firstLab.getByLabel('你的称呼').fill('多页甲');await firstLab.getByLabel('密码').fill(password)
  await firstLab.getByRole('button',{name:'注册并登录'}).click();await firstLab.getByRole('button',{name:'使用开发邮件箱完成验证'}).click();await firstLab.getByRole('button',{name:'创建空间'}).click()
  await expect(firstLab.getByText(/离线队列 0 项/)).toBeVisible()
  await page.getByRole('button',{name:/03 回忆/}).click()
  const second=await context.newPage();await second.goto('/#memories')

  await page.getByRole('button',{name:/雨天，也有好天气/}).first().click();await page.getByRole('button',{name:'编辑记录'}).click();await page.getByLabel('标题').fill('双标签只提交一次的咖啡回忆');await page.getByRole('button',{name:'保存记录'}).click();await page.getByRole('button',{name:'关闭弹窗'}).click()
  await expect(second.getByRole('button',{name:/双标签只提交一次的咖啡回忆/})).toBeVisible()

  await Promise.all([page.getByRole('button',{name:/08 系统/}).click(),second.getByRole('button',{name:/08 系统/}).click()])
  await Promise.all([page.getByRole('button',{name:'空间与功能'}).click(),second.getByRole('button',{name:'空间与功能'}).click()])
  const [labA,labB]=[page.getByTestId('sync-lab'),second.getByTestId('sync-lab')]
  await Promise.all([labA.getByRole('button',{name:'立即同步'}).click(),labB.getByRole('button',{name:'立即同步'}).click()])
  await expect(labA.getByText(/离线队列 0 项/)).toBeVisible();await expect(labB.getByText(/离线队列 0 项/)).toBeVisible()

  const api=await apiContext(playwright);await dataOf(await api.post('/v1/auth/login',{data:{email,password}}),z.any());const current=await dataOf(await api.get('/v1/spaces/current'),z.object({space:z.object({id:z.string()}),members:z.array(z.any())}));const changes=await dataOf(await api.get(`/v1/spaces/${current.space.id}/changes?cursor=0`),z.object({records:z.array(z.any()),plans:z.array(z.any()),journals:z.array(z.any()),events:z.array(z.any()),nextCursor:z.string()}));const cafe=changes.records.find((item:{id?:string})=>item.id==='memory-cafe');expect(cafe).toMatchObject({title:'双标签只提交一次的咖啡回忆',revision:2})
  await api.dispose();await second.close()
})

test('正式数据包可下载，删除预约可撤销并支持完整口令永久删除',async({page})=>{
  const spaceName='阿澄和小满的空间'
  await page.route('**/formal/v1/maintenance/status',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,data:{id:1,startedAt:'2026-10-29T01:00:00.000Z',completedAt:'2026-10-29T01:00:01.000Z',status:'success',expiredExports:2,deletedSpaces:1,removedMedia:3,expiredSessions:4,expiredTokens:5,details:{}},requestId:'e2e-maintenance'})}))
  await page.route('**/formal/v1/system/alerts',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,data:[{id:1,severity:'warning',source:'maintenance',code:'FILE_CLEANUP_PARTIAL',message:'维护数据库清理完成，但部分物理文件未能移除',details:{},createdAt:'2026-10-29T01:00:01.000Z'}],requestId:'e2e-alerts'})}))
  await page.goto('/#settings');await page.getByRole('button',{name:'先用虚构资料体验完整功能'}).click();await page.getByRole('button',{name:'空间与功能'}).click()
  const lab=page.getByTestId('sync-lab');await lab.getByLabel('邮箱').fill('privacy-owner@example.test');await lab.getByLabel('你的称呼').fill('隐私甲');await lab.getByLabel('密码').fill('privacy-owner-password-2026');await lab.getByRole('button',{name:'注册并登录'}).click();await lab.getByRole('button',{name:'使用开发邮件箱完成验证'}).click();await lab.getByRole('button',{name:'创建空间'}).click();await expect(lab.getByText(/离线队列 0 项/)).toBeVisible()
  await expect(page.getByText('通知投递队列')).toBeVisible();await expect(page.getByText(/verify_email:pending/)).toBeVisible()
  const privacy=page.getByTestId('formal-data-privacy');await expect(privacy.getByRole('heading',{name:'正式数据与隐私'})).toBeVisible()
  await expect(page.getByText('后台维护：正常')).toBeVisible()
  await expect(page.getByRole('region',{name:'系统告警'})).toContainText('FILE_CLEANUP_PARTIAL')
  const downloadPromise=page.waitForEvent('download');await privacy.getByRole('button',{name:'生成数据包'}).click();expect((await downloadPromise).suggestedFilename()).toMatch(/^quexin-space-export-\d{4}-\d{2}-\d{2}\.json\.gz$/);await expect(privacy.getByText('最近导出已就绪')).toBeVisible()
  await privacy.getByRole('button',{name:'预约删除'}).click();const scheduleDialog=page.getByRole('dialog',{name:'预约删除正式空间？'});await scheduleDialog.getByLabel('输入完整空间名称确认').fill(spaceName);await scheduleDialog.getByRole('button',{name:'确认预约删除'}).click();await expect(privacy.getByText('已预约删除')).toBeVisible()
  await privacy.getByRole('button',{name:'撤销预约'}).click();await expect(privacy.getByText('已预约删除')).toBeHidden()
  await privacy.getByRole('button',{name:'预约删除'}).click();await page.getByRole('dialog',{name:'预约删除正式空间？'}).getByLabel('输入完整空间名称确认').fill(spaceName);await page.getByRole('dialog',{name:'预约删除正式空间？'}).getByRole('button',{name:'确认预约删除'}).click();await privacy.getByRole('button',{name:'立即永久删除'}).click()
  const deleteDialog=page.getByRole('dialog',{name:'立即永久删除正式空间'});await deleteDialog.getByLabel(`输入“永久删除 ${spaceName}”`).fill(`永久删除 ${spaceName}`);await deleteDialog.getByRole('button',{name:'永久删除，无法恢复'}).click();await expect(lab.getByRole('heading',{name:'创建情侣空间'})).toBeVisible()
})
