import {test,expect,type BrowserContext} from '@playwright/test'
const api='http://127.0.0.1:6293/v1',password='care-browser-password'
async function account(context:BrowserContext,name:string){const email=`care-${crypto.randomUUID()}@example.test`,created=await context.request.post(api+'/auth/register',{data:{email,password,displayName:name}}),user=(await created.json()).data,mail=(await (await context.request.get(api+`/dev/mailbox/latest?email=${email}&purpose=verify_email`)).json()).data;await context.request.post(api+'/auth/email/verify',{data:{token:mail.token}});return user}
test('两账号实际分享需要、更新和撤回，私人草稿不发送',async({browser},testInfo)=>{
 const a=await browser.newContext(),b=await browser.newContext()
 try{await account(a,'关怀甲');await account(b,'关怀乙');const space=(await (await a.request.post(api+'/spaces',{data:{name:'关怀空间',selfDisplayName:'关怀甲'}})).json()).data.space,invite=(await (await a.request.post(api+`/spaces/${space.id}/invites`,{data:{ttlHours:1}})).json()).data;await b.request.post(api+`/invites/${invite.code}/accept`,{data:{displayName:'关怀乙'}})
  const pa=await a.newPage(),pb=await b.newPage();await pa.goto('/#care');await pb.goto('/#care')
  await pa.getByRole('button',{name:/想被听见 陪我说/}).click();await pa.getByLabel('可选的一句话（不会包含私人草稿）').fill('先听我把今天说完');await pa.getByRole('textbox',{name:'发生了什么？我希望被怎样对待？'}).fill('PRIVATE_DRAFT_NOT_SHARED');await pa.getByRole('button',{name:'保存私人草稿'}).click();await pa.getByRole('button',{name:/分享给/}).click();await expect(pa.getByText(/已分享「想被听见」/)).toBeVisible()
  await pb.reload();await expect(pb.getByText(/关怀甲现在「想被听见」/)).toBeVisible();await expect(pb.getByText('先听我把今天说完')).toBeVisible();await expect(pb.getByText('PRIVATE_DRAFT_NOT_SHARED')).toHaveCount(0);await pb.getByRole('main').screenshot({path:testInfo.outputPath('received-care.png')})
  await pa.getByLabel('可选的一句话（不会包含私人草稿）').fill('更新后的短消息');await pa.getByRole('button',{name:'更新分享'}).click();await pb.reload();await expect(pb.getByText('更新后的短消息')).toBeVisible();await pa.getByRole('button',{name:'撤回分享'}).click();await pb.reload();await expect(pb.getByText(/关怀甲现在/)).toHaveCount(0)
  expect((await b.request.delete(api+`/spaces/${space.id}/care`)).status()).toBe(404)
 }finally{await a.close();await b.close()}
})
test('没有共同空间时只保存在本机，不出现发送按钮',async({page})=>{await page.goto('/#care');await page.getByLabel('怎么称呼你').fill('本机甲');await page.getByLabel('怎么称呼对方').fill('本机乙');await page.getByRole('button',{name:'创建我们的空间'}).click();await expect(page.getByText(/登录并加入共同空间后/)).toBeVisible();await expect(page.getByRole('button',{name:/分享给/})).toHaveCount(0)})
