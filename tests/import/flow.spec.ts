import {test,expect,type Page} from '@playwright/test'

async function start(page:Page){
  await page.goto('/#import');await page.getByLabel('怎么称呼你').fill('阿澄');await page.getByLabel('怎么称呼对方').fill('小满');await page.getByRole('button',{name:'创建我们的空间'}).click()
}
async function generate(page:Page,text:string){
  await page.getByTestId('import-text').fill(text)
  await page.getByRole('button',{name:'下一步，确认范围'}).click();await page.getByLabel('这段聊天的基准日期').fill('2026-10-30');await page.getByRole('button',{name:'生成候选',exact:true}).click()
}
async function ask(page:Page,query:string){const assistant=page.getByRole('complementary',{name:'青鸟助手'}),open=page.getByRole('button',{name:/打开青鸟助手|展开青鸟助手|^青鸟助手$/}).filter({visible:true}).first();await expect(assistant.or(open)).toBeVisible();if(!await assistant.isVisible())await open.click();await assistant.getByLabel('给青鸟输入指令').fill(query);await assistant.getByRole('button',{name:'发送给青鸟'}).click();return assistant.getByLabel('青鸟回复').last()}

test('新资料导入到确认问答与原文追溯，私人计划不进入日程',async({page})=>{
  await start(page)
  const raw='我：2026-10-20，一起去青岛海边看日落。\n对方：明天有私人医院体检，不要告诉别人。\n我：下周一起去森林书店。'
  await generate(page,raw)
  const coast=page.getByRole('article',{name:/青岛海边/}),privatePlan=page.getByRole('article',{name:/医院体检/}),wish=page.getByRole('article',{name:/森林书店/})
  await expect(await ask(page,'青岛海边')).toContainText('没有找到可引用')
  await expect(privatePlan.getByRole('button',{name:'确认保存'})).toBeDisabled()
  await expect(wish.getByRole('checkbox')).toHaveCount(0);await expect(wish).toContainText('日期需要核对')
  await coast.getByRole('button',{name:'确认保存'}).click()
  const answer=page.getByLabel('青鸟回复').last();await expect(answer).toContainText('2026-10-20');await expect(answer).toContainText('青岛海边')
  await answer.getByRole('button',{name:/查看引用/}).click()
  const detail=page.getByRole('dialog');await expect(detail.getByRole('region',{name:'记录来源'})).toContainText('我：2026-10-20，一起去青岛海边看日落。');await expect(detail).toContainText('第 1 行');await detail.getByRole('button',{name:'关闭弹窗'}).click()
  await privatePlan.getByRole('checkbox').check();await privatePlan.getByRole('button',{name:'确认保存'}).click();await wish.getByRole('button',{name:'确认保存'}).click()
  await expect(await ask(page,'医院体检')).toContainText('没有找到可引用')
  const plans=await ask(page,'接下来有什么安排？');await expect(plans).toContainText('森林书店');await expect(plans).not.toContainText('医院体检')
  await plans.getByRole('button',{name:'查看对应日程'}).click();await expect(page.getByRole('main')).not.toContainText('医院体检')
  await page.reload();await expect(await ask(page,'青岛海边')).toContainText('2026-10-20')
})

test('TXT/JSON 导入保留行号，错误文件不生成候选，重复导入不新增',async({page})=>{
  await start(page);await page.getByRole('tab',{name:/上传文件/}).click()
  await page.getByLabel('选择导入文件').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{"unknown":"内容"}')})
  await expect(page.getByRole('alert')).toContainText('缺少');await expect(page.getByRole('button',{name:'下一步，确认范围'})).toBeDisabled()
  const content='\n我：2026-10-18，一起逛了银杏公园。\n\n对方：2026-10-19，一起喝了热可可。'
  await page.getByLabel('选择导入文件').setInputFiles({name:'秋天.txt',mimeType:'text/plain',buffer:Buffer.from(content)})
  await page.getByRole('button',{name:'下一步，确认范围'}).click();await page.getByRole('button',{name:'生成候选',exact:true}).click()
  const park=page.getByRole('article',{name:/银杏公园/});await expect(park).toContainText('第 2 行');await park.getByText('查看原文依据',{exact:false}).click();await expect(park.getByRole('region',{name:'记录来源'})).toContainText('秋天.txt')
  await park.getByRole('button',{name:'确认保存'}).click();await page.getByRole('article',{name:/热可可/}).getByRole('button',{name:'确认保存'}).click()
  await page.getByRole('button',{name:'再导入一些',exact:true}).click();await page.getByRole('button',{name:'下一步，确认范围'}).click();await page.getByRole('button',{name:'生成候选',exact:true}).click()
  await expect(page.getByText(/发现 2 条重复内容/)).toBeVisible();await expect(page.getByRole('article')).toHaveCount(0)
  await page.getByRole('button',{name:'选择内容',exact:true}).click();await page.getByRole('tab',{name:/上传文件/}).click()
  await page.getByLabel('选择导入文件').setInputFiles({name:'聊天.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({messages:[{sender:'我',date:'2026-10-20',text:'今天一起去了天文馆。'}]}))})
  await page.getByRole('button',{name:'下一步，确认范围'}).click();await page.getByRole('button',{name:'生成候选',exact:true}).click();await expect(page.getByRole('article',{name:/天文馆/})).toContainText('聊天.json')
})

test('日期核对与来源不被编辑正文改写，删除后旧回答立即失效',async({page})=>{
  await start(page);await generate(page,'我：一起登上了雪山。')
  const candidate=page.getByRole('article',{name:/雪山/});await candidate.getByRole('button',{name:'确认保存'}).click()
  const editor=page.getByRole('dialog');await expect(editor).toBeVisible();await editor.getByLabel('日期',{exact:true}).fill('2026-10-15');await editor.getByRole('textbox',{name:'内容',exact:true}).fill('一起登上了雪山，看见云海。');await editor.getByRole('button',{name:'保存记录'}).click();await candidate.getByRole('button',{name:'确认保存'}).click()
  const answer=await ask(page,'第一次去雪山');await expect(answer).toContainText('不代表实际第一次');await answer.getByRole('button',{name:/查看引用/}).click();await expect(page.getByRole('region',{name:'记录来源'})).toContainText('我：一起登上了雪山。');await page.getByRole('button',{name:'关闭弹窗'}).click()
  await page.getByRole('button',{name:'回忆',exact:true}).click();await page.getByRole('main').getByRole('button',{name:/一起登上了雪山/}).click();await page.getByRole('button',{name:'删除记录',exact:true}).click();await page.getByRole('button',{name:'确认删除',exact:true}).click()
  await expect(page.getByLabel('青鸟回复').last()).toContainText('没有找到可引用');await expect(page.getByLabel('青鸟回复').last().getByRole('button',{name:/查看引用/})).toHaveCount(0)
})

test('图片导入采用人工文字，设置说明模型、OCR 和微信的实际状态',async({page})=>{
  await start(page);await page.getByRole('tab',{name:/上传文件/}).click();await page.getByLabel('选择导入文件').setInputFiles('public/assets/coast.jpg')
  await expect(page.getByText('图片只在当前页面预览；可以发送到配置的识别模型，或手动填写文字。')).toBeVisible()
  await page.getByTestId('import-text').fill('我：2026-10-20，一起在海边拍照。');await page.getByRole('button',{name:'下一步，确认范围'}).click();await page.getByRole('button',{name:'生成候选',exact:true}).click();const candidate=page.getByRole('article',{name:/海边拍照/});await candidate.getByText('查看原文依据',{exact:false}).click();await expect(candidate).toContainText('图片文字为人工填写')
  await page.getByRole('button',{name:'系统',exact:true}).click();await page.getByRole('button',{name:'空间与功能'}).click();const capabilities=page.getByRole('region',{name:'青鸟能力状态'});await expect(capabilities).toContainText('服务端尚未配置；不会产生外部模型请求');await expect(capabilities).toContainText('未连接微信账号')
  await page.getByRole('radio',{name:/关闭自动整理/}).check();await expect(await ask(page,'海边')).toContainText('助手已关闭')
})

test('手机从记录入口导入新资料，青鸟回答可打开原文',async({page},testInfo)=>{
  await page.setViewportSize({width:390,height:844});await start(page)
  await page.getByRole('button',{name:'记录一件事',exact:true}).click();await page.getByRole('button',{name:/整理聊天或照片/}).click();await page.getByRole('region',{name:'青鸟添加资料'}).getByRole('button',{name:'粘贴文字',exact:true}).click()
  await generate(page,'我：2026-10-21，一起去星河天文馆。')
  await page.getByRole('article',{name:/星河天文馆/}).getByRole('button',{name:'确认保存'}).click()
  const answer=await ask(page,'星河天文馆');await expect(answer).toContainText('2026-10-21');await answer.getByRole('button',{name:/查看引用/}).click()
  const dialog=page.getByRole('dialog');await expect(dialog.getByRole('region',{name:'记录来源'})).toContainText('我：2026-10-21，一起去星河天文馆。')
  await page.screenshot({path:testInfo.outputPath('mobile-source.png'),fullPage:true})
})

test('CSV/HTML 导入与刷新恢复未完成批次',async({page},testInfo)=>{
 await start(page);await page.getByRole('tab',{name:/上传文件/}).click();await page.getByLabel('选择导入文件').setInputFiles({name:'聊天.csv',mimeType:'text/csv',buffer:Buffer.from('date,sender,text\n2026-10-18,我,一起去了植物园')});await expect(page.getByTestId('import-text')).toHaveValue(/植物园/)
 await page.getByRole('button',{name:'下一步，确认范围'}).click();await page.getByLabel('“阿澄”在原文中的称呼').fill('自己');await page.getByLabel('这段聊天的基准日期').fill('2026-10-18')
 await expect.poll(()=>page.evaluate(()=>new Promise<string>(resolve=>{const request=indexedDB.open('quexin-web',1);request.onsuccess=()=>{const db=request.result,get=db.transaction('meta').objectStore('meta').get('importDraft');get.onsuccess=()=>{db.close();resolve(get.result?.value?.selfAlias??'')}}}))).toBe('自己')
 await page.reload();await expect(page.getByText('已恢复未完成的导入')).toBeVisible();await expect(page.getByLabel('这段聊天的基准日期')).toHaveValue('2026-10-18');await expect(page.getByLabel('“阿澄”在原文中的称呼')).toHaveValue('自己');await page.getByRole('main').screenshot({path:testInfo.outputPath('restored-draft.png')});await page.getByRole('button',{name:'生成候选',exact:true}).click();await expect(page.getByRole('article',{name:/植物园/})).toBeVisible()
 await page.getByRole('button',{name:'再导入一些'}).click();await page.getByRole('tab',{name:/上传文件/}).click();await page.getByLabel('选择导入文件').setInputFiles({name:'聊天.html',mimeType:'text/html',buffer:Buffer.from('<ul><li>我：2026-10-19，一起去了美术馆。</li></ul>')});await expect(page.getByTestId('import-text')).toHaveValue(/美术馆/)
})

test('图片二进制不写入导入草稿，刷新后要求重新选择',async({page})=>{
 await start(page);await page.getByRole('tab',{name:/上传文件/}).click();await page.getByLabel('选择导入文件').setInputFiles('public/assets/coast.jpg')
 await expect.poll(()=>page.evaluate(()=>new Promise<string>(resolve=>{const request=indexedDB.open('quexin-web',1);request.onsuccess=()=>{const db=request.result,get=db.transaction('meta').objectStore('meta').get('importDraft');get.onsuccess=()=>{db.close();resolve(get.result?.value?.fileName??'')}}}))).toBe('coast.jpg')
 await page.reload();await expect(page.getByText(/图片或音频文件不会写入草稿/)).toBeVisible();await expect(page.getByRole('main').getByRole('img',{name:'导入的聊天截图'})).toHaveCount(0);await expect(page.getByRole('button',{name:'同意发送并识别文字'})).toHaveCount(0)
})
