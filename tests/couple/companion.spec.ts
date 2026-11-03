import {expect,test,type BrowserContext,type Page} from '@playwright/test'
const base='http://127.0.0.1:4688',api='http://127.0.0.1:4693/v1'
const password='couple-account-password-2026'
async function account(context:BrowserContext,name:string){
  const email=`couple-${crypto.randomUUID()}@example.test`
  const response=await context.request.post(`${api}/auth/register`,{data:{email,password,displayName:name}});expect(response.status()).toBe(201)
  const session=(await response.json()).data
  const mail=await context.request.get(`${api}/dev/mailbox/latest?email=${encodeURIComponent(email)}&purpose=verify_email`)
  expect((await context.request.post(`${api}/auth/email/verify`,{data:{token:(await mail.json()).data.token}})).status()).toBe(200)
  return{email,userId:session.userId}
}
async function settings(page:Page){await page.getByRole('button',{name:'系统',exact:true}).click();await page.getByRole('button',{name:'空间与功能'}).click()}
async function nest(page:Page){await page.getByRole('button',{name:'鹊巢',exact:true}).click()}
test('两个独立账号共享资料与宠物，主题私密独立，离线互动刷新后只执行一次',async({browser})=>{
  const a=await browser.newContext(),b=await browser.newContext()
  try{
    await account(a,'共同甲');await account(b,'共同乙')
    const space=(await (await a.request.post(`${api}/spaces`,{data:{name:'共同鹊巢',selfDisplayName:'共同甲'}})).json()).data.space
    const invite=(await (await a.request.post(`${api}/spaces/${space.id}/invites`,{data:{ttlHours:1}})).json()).data
    const pa=await a.newPage(),pb=await b.newPage();await pa.goto(`${base}/#nest`);await pb.goto(`${base}/#settings`)
    await pb.getByRole('button',{name:'空间与功能'}).click();await pb.getByLabel('6 位邀请码').fill(invite.code);await pb.getByRole('button',{name:'加入空间',exact:true}).click()
    await expect(pb.getByText('共同空间已连接 · 资料与小鹊由你们共同照顾')).toBeVisible();await nest(pb)
    await expect(pa.getByText('✦ 0 羽光',{exact:true})).toBeVisible();await expect(pb.getByText('✦ 0 羽光',{exact:true})).toBeVisible()
    await Promise.all([pa.getByRole('button',{name:'摸摸',exact:true}).click(),pb.getByRole('button',{name:'喂点心',exact:true}).click()])
    await expect(pa.getByText('✦ 5 羽光',{exact:true})).toBeVisible();await expect(pb.getByText('✦ 5 羽光',{exact:true})).toBeVisible()
    await pa.getByRole('button',{name:'给小鹊改名'}).click();await pa.getByLabel('小伙伴的名字').fill('团团');await pa.getByRole('button',{name:'就叫这个名字'}).click()
    await expect(pb.getByRole('heading',{name:'团团的小小世界'})).toBeVisible()
    await pa.getByRole('button',{name:'布置',exact:true}).click();await pa.getByRole('button',{name:/庭院春深/}).click()
    await expect(pb.getByText('庭院春深',{exact:true})).toBeVisible()
    await settings(pb);await pb.getByRole('button',{name:'外观与主题'}).click();await pb.getByRole('button',{name:/星河来信 深蓝/}).click()
    await nest(pb);await expect(pb.getByText('庭院春深',{exact:true})).toBeVisible()
    expect(await pa.locator('.app-shell').getAttribute('data-theme')).toBe('paper');expect(await pb.locator('.app-shell').getAttribute('data-theme')).toBe('cosmos')
    await settings(pb);const profileB=pb.getByRole('region',{name:'空间资料',exact:true});await expect(profileB.getByLabel('你的称呼',{exact:true})).toHaveValue('共同乙')
    await profileB.getByLabel('你的称呼',{exact:true}).fill('小满');await profileB.getByLabel('对方的称呼').fill('阿澄');await profileB.getByLabel('故事开始的日期').fill('2024-06-21');await profileB.getByRole('button',{name:'保存资料'}).click()
    await settings(pa);const profileA=pa.getByRole('region',{name:'空间资料',exact:true});await expect(profileA.getByLabel('你的称呼',{exact:true})).toHaveValue('阿澄');await expect(profileA.getByLabel('对方的称呼')).toHaveValue('小满');await expect(profileA.getByLabel('故事开始的日期')).toHaveValue('2024-06-21')
    await pa.getByRole('button',{name:'关怀',exact:true}).click();await pa.getByRole('textbox').first().fill('仅共同甲可见的私人草稿');await pa.getByRole('button',{name:'保存私人草稿',exact:true}).click()
    await pb.getByRole('button',{name:'关怀',exact:true}).click();await expect(pb.getByText('仅共同甲可见的私人草稿',{exact:true})).toHaveCount(0)
    await nest(pb);await pb.route('**/formal/v1/**',route=>route.abort())
    await pb.getByRole('button',{name:'喂点心',exact:true}).click();await expect(pb.getByText(/共同空间：1 项操作等待同步/)).toBeVisible()
    await pb.reload();await expect(pb.getByText(/共同空间：1 项操作等待同步/)).toBeVisible()
    await pb.unroute('**/formal/v1/**');await expect(pb.getByText('✦ 8 羽光',{exact:true})).toBeVisible();await nest(pa);await expect(pa.getByText('✦ 8 羽光',{exact:true})).toBeVisible()
    const state=(await (await a.request.get(`${api}/spaces/${space.id}/companion`)).json()).data
    expect(state.events.filter((e:{kind:string})=>e.kind==='feed')).toHaveLength(2)
    expect(state.events.map((e:{actorName:string})=>e.actorName)).toEqual(expect.arrayContaining(['共同甲','共同乙']))
  }finally{await a.close();await b.close()}
})

test('退出后另一账号看不到私人资料，重新登录原账号可恢复',async({browser})=>{
  const context=await browser.newContext(),other=await browser.newContext()
  try{
    const first=await account(context,'私密甲'),second=await account(other,'私密乙')
    const page=await context.newPage();await page.goto(`${base}/#care`)
    await page.getByRole('textbox').first().fill('账号甲独有的私密草稿');await page.getByRole('button',{name:'保存私人草稿',exact:true}).click()
    await expect(page.getByRole('button',{name:/^账号甲独有的私密草稿 /})).toBeVisible()
    const observer=await context.newPage();await observer.goto(`${base}/#care`);await expect(observer.getByRole('textbox').first()).toHaveValue('账号甲独有的私密草稿')
    await settings(page);await page.getByTestId('sync-lab').getByRole('button',{name:'退出',exact:true}).click()
    await page.goto(`${base}/#account/login`);await page.getByLabel('注册邮箱').fill(second.email);await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page.getByRole('heading',{name:'登录成功'})).toBeVisible();await page.getByRole('link',{name:'返回空间'}).click()
    await page.getByRole('button',{name:'关怀',exact:true}).click();await expect(page.getByRole('textbox').first()).toHaveValue('');await expect(page.getByText('账号甲独有的私密草稿',{exact:true})).toHaveCount(0)
    await expect(observer.getByRole('textbox').first()).toHaveValue('')
    await page.goto(`${base}/#account/login`);await page.getByLabel('注册邮箱').fill(first.email);await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page.getByRole('heading',{name:'登录成功'})).toBeVisible();await page.getByRole('link',{name:'返回空间'}).click();await page.getByRole('button',{name:'关怀',exact:true}).click()
    await expect(page.getByRole('textbox').first()).toHaveValue('账号甲独有的私密草稿')
    await expect(observer.getByRole('textbox').first()).toHaveValue('账号甲独有的私密草稿')
  }finally{await context.close();await other.close()}
})
