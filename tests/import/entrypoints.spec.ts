import {test,expect,type Page,type Locator} from '@playwright/test'

async function empty(page:Page){await page.goto('/');await page.getByLabel('怎么称呼你').fill('我');await page.getByLabel('怎么称呼对方').fill('对方');await page.getByRole('button',{name:'创建我们的空间'}).click()}
async function assistant(page:Page){const panel=page.getByRole('complementary',{name:'青鸟助手'});if(!await panel.isVisible())await page.getByRole('button',{name:/展开青鸟助手|打开青鸟助手/}).first().click();return panel}
async function addFile(panel:Locator,file:Parameters<Locator['setInputFiles']>[0]){await panel.getByRole('button',{name:'添加图片、文件或录音'}).click();await expect(panel.getByRole('region',{name:'青鸟添加资料'})).toBeVisible();await panel.getByLabel('选择青鸟附件').setInputFiles(file);await panel.getByRole('button',{name:'只在本机核对这个附件'}).click()}

test('七个一级导航；旧 import 链接和浏览器前进后退仍到资料核对',async({page},info)=>{
 await empty(page);const nav=page.getByRole('navigation',{name:'主导航'})
 await expect(nav.getByRole('button')).toHaveCount(7);await expect(nav.getByRole('button',{name:'导入'})).toHaveCount(0)
 const panel=await assistant(page);await panel.getByRole('button',{name:'添加图片、文件或录音'}).click();await expect(panel.getByRole('region',{name:'青鸟添加资料'})).toBeInViewport();await page.screenshot({path:info.outputPath('assistant-materials.png')});await panel.getByRole('button',{name:'粘贴文字',exact:true}).click()
 await expect(page).toHaveURL(/#import$/);await expect(page).toHaveTitle(/鹊信 · 资料核对/)
 await nav.getByRole('button',{name:'回忆',exact:true}).click();await page.goBack();await expect(page.getByRole('heading',{name:/^资料核对/})).toBeVisible();await page.goForward();await expect(page).toHaveURL(/#memories$/)
 await page.goto('/#import');await expect(page.getByLabel('想整理的内容',{exact:true})).toBeVisible()
 await page.setViewportSize({width:390,height:844});await expect(page.getByRole('navigation',{name:'手机底部导航'}).getByRole('button',{name:'导入'})).toHaveCount(0)
})

test('首页与青鸟都能核对全部候选，包含敏感候选',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'先用虚构资料体验完整功能'}).click()
 await page.getByRole('button',{name:'核对全部',exact:true}).click();await expect(page.getByRole('main').getByRole('heading',{name:'这些片段，值得留下吗？'})).toBeVisible()
 const count=await page.getByRole('main').getByRole('article').count();expect(count).toBeGreaterThan(3)
 const panel=await assistant(page);await panel.getByRole('button',{name:'添加图片、文件或录音'}).click();await panel.getByRole('button',{name:/查看待确认候选/}).click()
 await expect(page.getByRole('main').getByRole('article')).toHaveCount(count);await expect(page.getByRole('checkbox',{name:'我确认将这条私人内容保存在本机。'}).first()).toBeVisible()
})

for(const kind of ['txt','json'] as const)test(`${kind.toUpperCase()} 从青鸟交接到本机核对，无模型也可完整保存`,async({page},info)=>{
 const modelRequests:string[]=[];page.on('request',request=>{if(/\/assistant\/(chat|candidates)|\/import\/(ocr|transcribe)/.test(request.url()))modelRequests.push(request.url())})
 await empty(page);const panel=await assistant(page),text='我：2026-11-03，今天一起去了山间书店。'
 await addFile(panel,{name:`生活记录.${kind}`,mimeType:kind==='txt'?'text/plain':'application/json',buffer:Buffer.from(kind==='txt'?text:JSON.stringify({messages:[{sender:'我',date:'2026-11-03',text:'今天一起去了山间书店。'}]}))})
 await expect(page).toHaveURL(/#import$/);await expect(page.getByTestId('import-text')).toHaveValue(/山间书店/)
 await page.getByRole('button',{name:'下一步，确认范围'}).click();await page.getByRole('button',{name:'生成候选',exact:true}).click()
 const candidate=page.getByRole('article',{name:/山间书店/});await candidate.getByRole('button',{name:'确认保存'}).click();await expect(candidate).toContainText('已保存为正式记录')
 expect(modelRequests).toEqual([]);await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'回忆',exact:true}).click();await expect(page.getByRole('main')).toContainText('山间书店')
 await page.screenshot({path:info.outputPath('local-attachment.png')})
})

test('图片和录音经青鸟添加后可手动填写；未确认不发送识别服务',async({page})=>{
 const sent:string[]=[];page.on('request',request=>{if(/\/import\/(ocr|transcribe)/.test(request.url()))sent.push(request.url())})
 await empty(page);let panel=await assistant(page)
 await addFile(panel,'public/assets/coast.jpg');await expect(page.getByRole('main').getByRole('img',{name:'导入的聊天截图'})).toBeVisible()
 await page.getByTestId('import-text').fill('我：2026-11-03，看见海边夕阳。');await page.getByRole('button',{name:'下一步，确认范围'}).click();await page.getByRole('button',{name:'生成候选',exact:true}).click();await expect(page.getByRole('article',{name:/夕阳/})).toBeVisible()
 panel=await assistant(page);await addFile(panel,{name:'聊天.wav',mimeType:'audio/wav',buffer:Buffer.from('RIFF synthetic audio')})
 await expect(page.getByRole('button',{name:'同意发送并转写'})).toBeVisible();await page.getByTestId('import-text').fill('对方：以后想一起去山里。');expect(sent).toEqual([])
 await page.getByRole('button',{name:'下一步，确认范围'}).click();await page.getByRole('button',{name:'生成候选',exact:true}).click();await expect(page.getByRole('article',{name:/山里/})).toBeVisible()
})

test('新附件不会悄悄覆盖未完成草稿；格式错误保留原文',async({page})=>{
 await empty(page);await page.goto('/#import');await page.getByTestId('import-text').fill('我：旧草稿还没有核对。')
 await expect.poll(async()=>page.evaluate(async()=>{const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('quexin-web');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});try{return await new Promise<string>((resolve,reject)=>{const r=db.transaction('meta').objectStore('meta').get('importDraft');r.onsuccess=()=>resolve(r.result?.value?.text??'');r.onerror=()=>reject(r.error)})}finally{db.close()}})).toBe('我：旧草稿还没有核对。')
 // A visible round trip verifies draft persistence instead of assuming a save delay.
 await expect(page.getByText('IndexedDB 已就绪').first()).toBeVisible()
 const panel=await assistant(page)
 await addFile(panel,{name:'新的.txt',mimeType:'text/plain',buffer:Buffer.from('我：新的资料。')})
 const replacement=page.getByRole('region',{name:'替换未完成草稿'});await expect(replacement).toBeVisible();await replacement.getByRole('button',{name:'保留原草稿'}).click();await expect(page.getByTestId('import-text')).toHaveValue('我：旧草稿还没有核对。')
 await addFile(panel,{name:'损坏.json',mimeType:'application/json',buffer:Buffer.from('{broken')});await replacement.getByRole('button',{name:'使用新附件'}).click();await expect(page.getByRole('alert')).toContainText('JSON 格式有误');await expect(page.getByTestId('import-text')).toHaveValue('我：旧草稿还没有核对。')
})

test('手机记录入口打开青鸟附件菜单，粘贴入口正常退出助手覆盖层',async({page})=>{
 await page.setViewportSize({width:390,height:844});await empty(page)
 await page.getByRole('button',{name:'记录一件事',exact:true}).click();await page.getByRole('button',{name:/整理聊天或照片/}).click()
 const panel=page.getByRole('complementary',{name:'青鸟助手'});await expect(panel.getByRole('region',{name:'青鸟添加资料'})).toBeVisible()
 await panel.getByRole('button',{name:'粘贴文字',exact:true}).click();await expect(panel).toHaveCount(0);await expect(page.getByTestId('import-text')).toBeVisible()
})
