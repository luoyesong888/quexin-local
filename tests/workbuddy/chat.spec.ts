import {test as base,expect,type Page,type Locator} from '@playwright/test'
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {convertLegacyWorkBuddyExport} from '../../shared/workbuddy-chat-contract.mjs'
import {shareableEntities} from '../../shared/sync-policy.mjs'

const password='workbuddy-chat-test-password'
const test=base.extend<{folder:string}>({folder:async({},use)=>{const root=await mkdtemp('/private/tmp/quexin-wb-browser-');try{await use(root)}finally{await rm(root,{recursive:true,force:true})}}})
async function setup(page:Page){
 await page.goto('/#settings');await page.getByRole('button',{name:'先用虚构资料体验完整功能'}).click()
 await page.getByRole('button',{name:'空间与功能',exact:true}).click()
 const lab=page.getByTestId('sync-lab')
 await lab.getByLabel('邮箱').fill(`wb-${crypto.randomUUID()}@example.test`);await lab.getByLabel('你的称呼').fill('聊天测试者');await lab.getByLabel('密码').fill(password)
 await lab.getByRole('button',{name:'注册并登录'}).click();await lab.getByRole('button',{name:'使用开发邮件箱完成验证'}).click()
 const open=page.getByRole('button',{name:/展开青鸟助手|打开青鸟助手/});if(await open.isVisible())await open.click()
 return page.getByRole('complementary',{name:'青鸟助手'})
}
async function command(panel:Locator,text:string){await panel.getByLabel('给青鸟输入指令').fill(text);await panel.getByRole('button',{name:'发送给青鸟'}).click()}
async function connect(panel:Locator,folder:string){
 await command(panel,'检查 WorkBuddy 新聊天')
 const card=panel.getByLabel('青鸟聊天资料');await card.getByLabel('交换箱完整路径').fill(join(folder,'exchange'));await card.getByLabel('当前账号密码').fill(password)
 await card.getByRole('button',{name:'授权连接这个文件夹'}).click();await expect(card).toContainText('暂未发现完成批次')
 return card
}
async function deliver(folder:string){
 const sourceDir=join(folder,'source');await mkdir(sourceDir)
 await writeFile(join(sourceDir,'chat.json'),JSON.stringify({self:'我',partner:'对方',total:3,range:['2026-11-01','2026-11-01'],chats:[{date:'2026-11-01',messages:[
  {sender:'我',time:'10:00',text:'喜欢海边咖啡 SYNTHETIC_SELECTED'},
  {sender:'对方',time:'10:01',text:'不要自动发送 SYNTHETIC_UNSELECTED'},
  {sender:'我',time:'10:02',text:'明天安排散步'}]}]}))
 return convertLegacyWorkBuddyExport({sourceDir,inboxRoot:join(folder,'exchange'),spaceId:'personal',conversationId:'couple',batchId:'browser-batch',jobId:'browser-job'})
}
async function receive(card:Locator){await card.getByRole('button',{name:'重新检查交换箱'}).click();const batch=card.getByLabel('聊天批次 browser-batch');await expect(batch).toContainText('3 条消息');await expect(batch.getByRole('button',{name:'确认读取并归档'})).toBeDisabled();await batch.getByRole('checkbox').check();await batch.getByRole('button',{name:'确认读取并归档'}).click();await expect(card).toContainText('归档完成：新增 3 条')}
async function select(card:Locator){await card.getByLabel('聊天关键词').fill('海边');await card.getByRole('button',{name:'检索聊天',exact:true}).click();await expect(card.getByLabel('聊天检索结果')).toContainText('SYNTHETIC_SELECTED');await card.getByRole('checkbox',{name:/选择消息/}).check();await card.getByRole('button',{name:'整理所选 1 条片段'}).click();return card.getByLabel('聊天资料发送确认')}
async function browserData(page:Page){return page.evaluate(async()=>{const databases=await indexedDB.databases(),result:unknown[]=[];for(const {name} of databases){if(!name?.startsWith('quexin'))continue;const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open(name);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});for(const store of Array.from(db.objectStoreNames)){const rows=await new Promise<unknown[]>((resolve,reject)=>{const r=db.transaction(store).objectStore(store).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});result.push(...rows)}db.close()}return JSON.stringify(result)})}

test('聊天完成连接、范围批准、检索、原文、本地整理和私人保存；未确认原文不持久化',async({page,folder,request})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message))
 const panel=await setup(page),card=await connect(panel,folder),before=(await (await request.get('http://127.0.0.1:6194/stats')).json()).requests.length
 await deliver(folder);await receive(card)
 await expect(card).not.toContainText('SYNTHETIC_UNSELECTED')
 const preview=await select(card)
 await expect(preview).toContainText('SYNTHETIC_SELECTED');await expect(preview).not.toContainText('SYNTHETIC_UNSELECTED')
 expect(await browserData(page)).not.toContain('SYNTHETIC_SELECTED')
 await card.getByRole('button',{name:'查看这条原文'}).click();await expect(card.getByLabel('聊天原文')).toContainText('第 1 行')
 await preview.getByRole('button',{name:'只在本机整理'}).click()
 const candidate=card.getByLabel('聊天候选');await expect(candidate.getByLabel('候选类型')).toHaveValue('偏好')
 await candidate.getByLabel('候选标题').fill('海边咖啡偏好');await candidate.getByRole('button',{name:'确认保存为私人记录'}).click();await expect(candidate).toContainText('已保存为私人记录')
 const persisted=await browserData(page);expect(persisted).toContain('"type":"workbuddy-chat"');expect(persisted).toContain('"sensitive":true');expect(persisted).not.toContain('SYNTHETIC_UNSELECTED')
 expect((await (await request.get('http://127.0.0.1:6194/stats')).json()).requests).toHaveLength(before)
 await page.screenshot({path:'test-results/workbuddy/chat-private-save.png'})
 await page.reload();const data=await browserData(page);expect(data).toContain('海边咖啡偏好');expect(errors).toEqual([])
})

test('外部模型逐次批准片段，取消不调用模型；只发送确认行，来源可追溯',async({page,folder,request})=>{
 const panel=await setup(page),card=await connect(panel,folder);await deliver(folder);await receive(card)
 const before=(await (await request.get('http://127.0.0.1:6194/stats')).json()).requests.length
 let preview=await select(card)
 await expect(preview.getByRole('button',{name:'确认发送这 1 条片段'})).toBeDisabled()
 await preview.getByRole('button',{name:'取消这次整理'}).click()
 expect((await (await request.get('http://127.0.0.1:6194/stats')).json()).requests).toHaveLength(before)
 await card.getByRole('button',{name:'整理所选 1 条片段'}).click();preview=card.getByLabel('聊天资料发送确认')
 await preview.getByRole('checkbox').check();await preview.getByRole('button',{name:'确认发送这 1 条片段'}).click()
 await expect(card.getByLabel('聊天候选')).toContainText('待你核对的候选')
 const calls=(await (await request.get('http://127.0.0.1:6194/stats')).json()).requests
 expect(calls).toHaveLength(before+1);expect(JSON.stringify(calls.at(-1).input)).toContain('SYNTHETIC_SELECTED');expect(JSON.stringify(calls.at(-1).input)).not.toContain('SYNTHETIC_UNSELECTED')
 await card.getByLabel('聊天候选').getByText('核对原文与来源').click();await expect(card.getByLabel('聊天候选')).toContainText('browser-batch')
 expect(await browserData(page)).not.toContain('SYNTHETIC_SELECTED')
 await panel.getByRole('button',{name:'开始新对话'}).click();await expect(panel.getByLabel('聊天候选')).toHaveCount(0)
})

test('本机 HTTP 接口要求登录、同源和当前身份；未连接有可操作的空态',async({page,request})=>{
 const anonymous=await request.post('/formal/v1/workbuddy/status',{data:{expectedOwnerId:'someone'}});expect(anonymous.status()).toBe(401)
 const panel=await setup(page);await command(panel,'检查 WorkBuddy 新聊天');await expect(panel.getByLabel('交换箱完整路径')).toBeVisible()
 const responses=await page.evaluate(async()=>{
  const session=await (await fetch('/formal/v1/session')).json()
  const post=async(body:object)=>{const r=await fetch('/formal/v1/workbuddy/status',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return{status:r.status,body:await r.json()}}
  return{spoof:await post({expectedOwnerId:'someone'}),extra:await post({expectedOwnerId:session.data.userId,inboxRoot:'/etc'}),owner:session.data.userId}
 })
 expect(responses.spoof.body.error.code).toBe('ACCOUNT_CHANGED');expect(responses.extra.body.error.code).toBe('VALIDATION_FAILED')
 const cross=await page.request.post('/formal/v1/workbuddy/status',{headers:{origin:'https://untrusted.invalid'},data:{expectedOwnerId:responses.owner}});expect(cross.status()).toBe(403)
})

test('损坏批次不伪造成功；文件修复重试必须再次确认范围',async({page,folder})=>{
 const panel=await setup(page),card=await connect(panel,folder),delivered=await deliver(folder)
 const relative=delivered.manifest.chunks[0].file,file=join(folder,'exchange/personal/ready/browser-batch',relative),good=await readFile(file)
 await writeFile(file,'BROKEN_SYNTHETIC_ONLY')
 await card.getByRole('button',{name:'重新检查交换箱'}).click()
 const batch=card.getByLabel('聊天批次 browser-batch')
 await batch.getByRole('checkbox').check();await batch.getByRole('button',{name:'确认读取并归档'}).click()
 await expect(card.getByRole('alert').first()).toBeVisible()
 await card.getByRole('button',{name:'重新检查交换箱'}).click();await expect(batch).toContainText('需要处理')
 await expect(card).not.toContainText('归档完成：新增')
 const isolated=await readdir(join(folder,'exchange/personal/quarantine'));expect(isolated).toHaveLength(1)
 await writeFile(join(folder,'exchange/personal/quarantine',isolated[0],relative),good)
 await batch.getByRole('button',{name:'文件修复后重新检查'}).click()
 await expect(batch.getByRole('checkbox')).not.toBeChecked();await expect(batch.getByRole('button',{name:'确认读取并归档'})).toBeDisabled()
 await batch.getByRole('checkbox').check();await batch.getByRole('button',{name:'确认读取并归档'}).click();await expect(card).toContainText('归档完成：新增 3 条')
})

test('浏览器备份排除未确认归档，仅保存选中私人节选，恢复后不自动共享',async({page,folder,browser})=>{
 const panel=await setup(page),card=await connect(panel,folder);await deliver(folder);await receive(card);const preview=await select(card)
 await preview.getByRole('button',{name:'只在本机整理'}).click();await expect(card.getByLabel('聊天候选')).toBeVisible()
 const backup=async()=>{await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'系统',exact:true}).click();await page.getByRole('button',{name:'数据与备份',exact:true}).click();const pending=page.waitForEvent('download');await page.getByRole('button',{name:'导出完整备份'}).click();const path=(await (await pending).path())!;return{path,data:JSON.parse(await readFile(path,'utf8'))}}
 const before=await backup();expect(JSON.stringify(before.data)).not.toContain('SYNTHETIC_')
 await card.getByLabel('聊天候选').getByRole('button',{name:'确认保存为私人记录'}).click();await expect(card.getByLabel('聊天候选')).toContainText('已保存为私人记录')
 const after=await backup();expect(JSON.stringify(after.data)).toContain('SYNTHETIC_SELECTED');expect(JSON.stringify(after.data)).not.toContain('SYNTHETIC_UNSELECTED')
 const saved=after.data.records.find((row:{provenance?:{type:string}})=>row.provenance?.type==='workbuddy-chat');expect(saved.sensitive).toBe(true);expect(saved.mediaScope).toBe('private');expect(shareableEntities(after.data).some((row:{item:{id:string}})=>row.item.id===saved.id)).toBe(false)
 const restoredContext=await browser.newContext(),restored=await restoredContext.newPage()
 try{
  await restored.goto('/#settings');await restored.getByLabel('怎么称呼你').fill('恢复测试者');await restored.getByLabel('怎么称呼对方').fill('对方');await restored.getByRole('button',{name:'创建我们的空间'}).click()
  await restored.getByRole('button',{name:'数据与备份',exact:true}).click();await restored.getByLabel('选择 JSON 备份文件').setInputFiles(after.path);await restored.getByRole('dialog',{name:'恢复这份备份？'}).getByRole('button',{name:'确认恢复'}).click()
  const restoredData=await browserData(restored);expect(restoredData).toContain('SYNTHETIC_SELECTED');expect(restoredData).not.toContain('SYNTHETIC_UNSELECTED');expect(restoredData).toContain('"mediaScope":"private"')
 }finally{await restoredContext.close()}
})
