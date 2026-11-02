import {test,expect,type Page} from '@playwright/test'
const password='recognition-password'
async function setup(page:Page){
 await page.goto('/#settings');await page.getByRole('button',{name:'先用虚构资料体验完整功能'}).click();await page.getByRole('button',{name:'空间与功能',exact:true}).click();const lab=page.getByTestId('sync-lab'),email=`recognition-${crypto.randomUUID()}@example.test`;await lab.getByLabel('邮箱').fill(email);await lab.getByLabel('你的称呼').fill('识别甲');await lab.getByLabel('密码').fill(password);await lab.getByRole('button',{name:'注册并登录'}).click();await lab.getByRole('button',{name:'使用开发邮件箱完成验证'}).click();await page.getByRole('button',{name:'空间与功能',exact:true}).click();await page.getByRole('radio',{name:/真实模型 · test-structured-model/}).check();await page.getByRole('checkbox',{name:/允许把每次发送前列出的/}).check()
}
test('图片 OCR 只发送所选图片，结果可校正并保留识别来源',async({page,request},testInfo)=>{
 expect((await request.post('http://127.0.0.1:6093/v1/import/ocr',{headers:{'content-type':'image/png','x-quexin-consent':'true'},data:Buffer.from('x')})).status()).toBe(401)
 await setup(page);await page.goto('/#import');await page.getByRole('tab',{name:/上传文件/}).click();await page.getByLabel('选择导入文件').setInputFiles('public/assets/coast.jpg');await page.getByRole('button',{name:'同意发送并识别文字'}).click();await expect(page.getByTestId('import-text')).toHaveValue(/OCR 识别到/);await page.getByRole('main').screenshot({path:testInfo.outputPath('ocr-correction.png')})
 await page.getByTestId('import-text').fill('我：2026-10-21，OCR 识别到一起去了海边，已人工校正。');await page.getByRole('button',{name:'下一步，确认范围'}).click();await page.getByRole('button',{name:'发送所选文字并生成'}).click();const candidate=page.getByRole('article',{name:/模型整理的候选/});await candidate.getByText('查看原文依据',{exact:false}).click();await expect(candidate).toContainText('图片 OCR 后人工核对')
 const stats=await (await request.get('http://127.0.0.1:6094/stats')).json(),ocr=stats.requests.find((item:any)=>item.body?.text?.format?.name==='quexin_ocr');expect(JSON.stringify(ocr.input)).toContain('input_image');expect(JSON.stringify(ocr.input)).not.toContain('雨天，也有好天气')
})
test('识别接口要求逐次同意并拒绝不支持的文件类型',async({page})=>{
 await setup(page)
 const missing=await page.evaluate(()=>fetch('/formal/v1/import/ocr',{method:'POST',headers:{'content-type':'image/png'},body:new Uint8Array([1])}).then(r=>r.json()));expect(missing.error.code).toBe('CONSENT_REQUIRED')
 const invalid=await page.evaluate(()=>fetch('/formal/v1/import/transcribe',{method:'POST',headers:{'content-type':'application/zip','x-quexin-consent':'true','x-file-name':'bad.zip'},body:new Uint8Array([1])}).then(r=>r.json()));expect(invalid.error.code).toBe('VALIDATION_FAILED')
})
test('录音转写与取消均保留人工校正入口',async({page,request},testInfo)=>{
 await setup(page);await page.goto('/#import');await page.getByRole('tab',{name:/上传文件/}).click();await page.getByLabel('选择导入文件').setInputFiles({name:'语音记录.wav',mimeType:'audio/wav',buffer:Buffer.from('RIFFfake-audio')});await page.getByRole('button',{name:'同意发送并转写'}).click();await expect(page.getByTestId('import-text')).toHaveValue(/录音转写的海边散步/);await page.getByRole('main').screenshot({path:testInfo.outputPath('audio-transcript.png')})
 const stats=await (await request.get('http://127.0.0.1:6094/stats')).json();expect(stats.requests.at(-1)).toMatchObject({kind:'transcription'});expect(stats.requests.at(-1).contentType).toContain('multipart/form-data')
 await page.getByLabel('选择导入文件').setInputFiles({name:'slow-cancel.wav',mimeType:'audio/wav',buffer:Buffer.from('RIFFslow')});await page.getByRole('button',{name:'同意发送并转写'}).click();await page.getByRole('button',{name:'取消识别'}).click();await expect(page.getByRole('alert')).toHaveCount(0);await expect.poll(async()=>((await (await request.get('http://127.0.0.1:6094/stats')).json()).aborted)).toBeGreaterThan(0)
})
