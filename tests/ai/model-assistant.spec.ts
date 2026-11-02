import {test,expect,type Page} from '@playwright/test'
const email=()=>`ai-${crypto.randomUUID()}@example.test`,password='model-assistant-password'
async function setup(page:Page,name='模型甲'){
 await page.goto('/#settings');await page.getByRole('button',{name:'先用虚构资料体验完整功能'}).click();await page.getByRole('button',{name:'空间与功能',exact:true}).click()
 const lab=page.getByTestId('sync-lab'),mail=email();await lab.getByLabel('邮箱').fill(mail);await lab.getByLabel('你的称呼').fill(name);await lab.getByLabel('密码').fill(password);await lab.getByRole('button',{name:'注册并登录'}).click();await lab.getByRole('button',{name:'使用开发邮件箱完成验证'}).click()
 await page.getByRole('button',{name:'空间与功能',exact:true}).click();await page.getByRole('radio',{name:/真实模型 · test-structured-model/}).check();await page.getByRole('checkbox',{name:/允许把每次发送前列出的/}).check()
}
async function ask(page:Page,question:string){const open=page.getByRole('button',{name:/展开青鸟助手|打开青鸟助手/});if(await open.isVisible())await open.click();const assistant=page.getByRole('complementary',{name:'青鸟助手'});await assistant.getByLabel('给青鸟输入指令').fill(question);await assistant.getByRole('button',{name:'发送给青鸟'}).click();return assistant}

test('配置不泄露密钥，发送前确认范围，模型答案只使用合法引用',async({page,request},testInfo)=>{
 expect((await request.get('http://127.0.0.1:6093/v1/assistant/config')).status()).toBe(401)
 await setup(page);const config=await page.evaluate(()=>fetch('/formal/v1/assistant/config').then(r=>r.json()));expect(config.data).toMatchObject({enabled:true,provider:'OpenAI Responses API',model:'test-structured-model'});expect(JSON.stringify(config)).not.toContain('assistant-test-key');expect(JSON.stringify(config)).not.toContain('6094')
 const assistant=await ask(page,'海边是什么时候？');const preview=assistant.getByLabel('发送资料确认').last();await preview.getByText('查看与调整资料').click();await expect(preview).toContainText('把日落装进口袋');await expect(preview).not.toContainText('面试前');await assistant.screenshot({path:testInfo.outputPath('send-preview.png')});await preview.getByRole('button',{name:'继续使用这些资料'}).click()
 const answer=assistant.getByLabel('青鸟回复').last();await expect(answer).toContainText('根据已确认资料');await expect(answer.getByRole('button',{name:/查看引用/})).toHaveCount(1);await assistant.screenshot({path:testInfo.outputPath('model-answer.png')})
 const stats=await (await request.get('http://127.0.0.1:6094/stats')).json(),last=stats.requests.at(-1);expect(last.body.store).toBe(false);expect(last.body.stream).toBe(true);expect(last.body.text.format.strict).toBe(true);expect(JSON.stringify(last.input)).not.toContain('面试前');expect(JSON.stringify(last.input)).not.toContain('私人')
})

test('服务端拒绝私人伪造输入并截断过长来源',async({page,request})=>{
 await setup(page)
 const before=(await (await request.get('http://127.0.0.1:6094/stats')).json()).requests.length
 const rejected=await page.evaluate(()=>fetch('/formal/v1/assistant/answer',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({consent:true,question:'私人资料',sources:[{id:'private',title:'私人',body:'SECRET_MODEL_INPUT',date:'2026-10-30',kind:'回忆',status:'confirmed',sensitive:true}],plans:[]})}).then(r=>r.text()))
 expect(rejected).toContain('VALIDATION_FAILED');expect((await (await request.get('http://127.0.0.1:6094/stats')).json()).requests).toHaveLength(before)
 const result=await page.evaluate(()=>fetch('/formal/v1/assistant/answer',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({consent:true,question:'长资料',sources:[{id:'long',title:'长资料',body:'甲'.repeat(3000),date:'2026-10-30',kind:'回忆',status:'confirmed',sensitive:false}],plans:[]})}).then(r=>r.text()))
 expect(result).toContain('event: result');const stats=await (await request.get('http://127.0.0.1:6094/stats')).json();expect(stats.requests.at(-1).input.sources[0].body).toHaveLength(1800)
})

for(const issue of ['invalid citation','invalid schema','refuse','http error','disconnect','timeout'])test(`异常 ${issue} 回退本地检索`,async({page})=>{
 await setup(page);const assistant=await ask(page,`海边 ${issue}`),preview=assistant.getByLabel('发送资料确认').last();await preview.getByRole('button',{name:'继续使用这些资料'}).click();await expect(assistant.locator('.chat-message.error').last()).toContainText('已改用本地检索');await expect(assistant.getByLabel('青鸟回复').last()).toContainText('海边')
})

test('用户取消会中止上游请求并保留本地结果',async({page,request})=>{
 await setup(page);const assistant=await ask(page,'海边 slow cancel');await assistant.getByLabel('发送资料确认').last().getByRole('button',{name:'继续使用这些资料'}).click();await assistant.getByRole('button',{name:'停止'}).click();await expect(assistant.locator('.chat-message.error').last()).toContainText('取消');await expect.poll(async()=>((await (await request.get('http://127.0.0.1:6094/stats')).json()).aborted)).toBeGreaterThan(0)
})

test('模型候选保留原文行号，敏感内容仍由本地规则加固',async({page,request})=>{
 await setup(page);await page.goto('/#import');await page.getByLabel('想整理的内容',{exact:true}).fill('我：2026-10-20，去私人医院复查。');await page.getByRole('button',{name:'下一步，确认范围'}).click();await page.getByRole('button',{name:'发送所选文字并生成'}).click()
 const candidate=page.getByRole('article',{name:/模型整理的候选/});await expect(candidate).toContainText('私人内容');await candidate.getByText('查看原文依据',{exact:false}).click();await expect(candidate).toContainText('第 1 行')
 const stats=await (await request.get('http://127.0.0.1:6094/stats')).json();expect(stats.requests.at(-1).body.text.format.name).toBe('quexin_candidates')
})

test('模型候选结构错误时改用本地规则',async({page})=>{
 await setup(page);await page.goto('/#import');await page.getByLabel('想整理的内容',{exact:true}).fill('我：2026-10-20，invalid schema 一起去了天文馆。');await page.getByRole('button',{name:'下一步，确认范围'}).click();await page.getByRole('button',{name:'发送所选文字并生成'}).click();await expect(page.getByRole('article',{name:/invalid schem/})).toBeVisible()
})

test('取消模型候选整理不会生成内容',async({page})=>{
 await setup(page);await page.goto('/#import');await page.getByRole('main').getByRole('textbox',{name:'想整理的内容',exact:true}).fill('我：2026-10-21，slow cancel 一起去海边。');await page.getByRole('button',{name:'下一步，确认范围'}).click();await page.getByRole('button',{name:'发送所选文字并生成'}).click();await page.getByRole('button',{name:'取消模型整理'}).click();await expect(page.getByRole('article',{name:/slow cancel/})).toHaveCount(0)
})

test('设置页可安全录入 DeepSeek API，读取接口不回传密钥',async({page})=>{
 await setup(page,'配置管理员');await page.reload();await page.getByRole('button',{name:'空间与功能',exact:true}).click()
 const region=page.getByRole('region',{name:'青鸟能力状态'}),secret='sk-deepseek-ui-secret-123'
 await region.getByLabel('启用外部模型').check();await region.getByLabel('服务商').selectOption('deepseek');await expect(region.getByLabel('API 地址')).toHaveValue('https://api.deepseek.com');await region.getByLabel('模型',{exact:true}).selectOption('deepseek-flash');await region.getByLabel('API Key').fill(secret);await region.getByLabel('当前账号密码').fill(password);await region.getByRole('button',{name:'保存 API 配置'}).click()
 await expect(region.getByRole('status')).toContainText('请重启本地服务后生效')
 const status=await page.evaluate(()=>fetch('/formal/v1/admin/assistant-config').then(response=>response.json()));expect(status.data).toMatchObject({enabled:true,provider:'deepseek',apiUrl:'https://api.deepseek.com',model:'deepseek-flash',hasApiKey:true,ocrEnabled:true,transcriptionEnabled:false});expect(JSON.stringify(status)).not.toContain(secret)
})
