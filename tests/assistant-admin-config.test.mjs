import test from 'node:test'
import assert from 'node:assert/strict'
import {lstat,mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {readAssistantAdminConfig,saveAssistantAdminConfig} from '../server/lib/optional-config.mjs'
import {parseManagedEnvironment} from '../scripts/lib/workbuddy-options.mjs'

test('页面配置 DeepSeek 时保留邮件设置、隐藏密钥并写入 600 权限文件',async()=>{
 const root=await mkdtemp('/private/tmp/quexin-assistant-admin-'),path=join(root,'.env.local'),backups=join(root,'backups'),secret='sk-test-deepseek-secret-123'
 const env={OPTIONAL_CONFIG_PATH:path,OPTIONAL_CONFIG_BACKUP_ROOT:backups}
 try{
  await writeFile(path,'CUSTOM_VALUE="keep"\nNOTIFICATION_DRIVER="smtp"\nSMTP_URL="smtps://user:mail-secret@smtp.example.test:465"\nMAIL_FROM="鹊信 <mail@example.test>"\n',{mode:0o600})
  const saved=await saveAssistantAdminConfig({enabled:true,provider:'deepseek',apiUrl:'https://wrong.example.test',apiKey:secret,model:'deepseek-flash',transcriptionModel:'ignored'},env)
  assert.deepEqual(saved,{available:true,enabled:true,provider:'deepseek',providerName:'DeepSeek Responses API',apiUrl:'https://api.deepseek.com',model:'deepseek-flash',transcriptionModel:'',hasApiKey:true,ocrEnabled:true,transcriptionEnabled:false})
  assert.equal(JSON.stringify(saved).includes(secret),false)
  const text=await readFile(path,'utf8'),managed=parseManagedEnvironment(text)
  assert.equal(text.includes(secret),true);assert.equal(text.includes('CUSTOM_VALUE="keep"'),true);assert.equal(managed.SMTP_URL,'smtps://user:mail-secret@smtp.example.test:465');assert.equal(managed.ASSISTANT_PROVIDER,'deepseek');assert.equal((await lstat(path)).mode&0o777,0o600)
  assert.equal((await readdir(backups)).length,1)
  const status=await readAssistantAdminConfig(env);assert.equal(JSON.stringify(status).includes(secret),false);assert.equal(JSON.stringify(status).includes('mail-secret'),false)
  const disabled=await saveAssistantAdminConfig({enabled:false,provider:'deepseek',apiKey:'',apiUrl:'',model:'',transcriptionModel:''},env),after=parseManagedEnvironment(await readFile(path,'utf8'))
  assert.equal(disabled.enabled,false);assert.equal(after.ASSISTANT_API_KEY,undefined);assert.equal(after.SMTP_URL,'smtps://user:mail-secret@smtp.example.test:465')
 }finally{await rm(root,{recursive:true,force:true})}
})

test('DeepSeek 拒绝非预设模型，兼容接口拒绝远程 HTTP',async()=>{
 const root=await mkdtemp('/private/tmp/quexin-assistant-invalid-'),env={OPTIONAL_CONFIG_PATH:join(root,'.env.local')}
 try{
  await assert.rejects(()=>saveAssistantAdminConfig({enabled:true,provider:'deepseek',apiKey:'valid-secret-key',apiUrl:'https://api.deepseek.com',model:'deepseek-chat',transcriptionModel:''},env),/模型只允许/)
  await assert.rejects(()=>saveAssistantAdminConfig({enabled:true,provider:'openai-compatible',apiKey:'valid-secret-key',apiUrl:'http://remote.example.test/v1',model:'model-a',transcriptionModel:''},env),/服务地址只允许/)
 }finally{await rm(root,{recursive:true,force:true})}
})
