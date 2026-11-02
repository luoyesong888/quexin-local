import {randomUUID} from 'node:crypto'
import {request} from 'node:http'
import {chmod,copyFile,lstat,mkdir,readFile,rename,writeFile} from 'node:fs/promises'
import {dirname,join} from 'node:path'
import {managedEnvironment,mergeManagedEnvironment,parseManagedEnvironment,publicOptionalStatus,validateWorkBuddyOptions} from '../../scripts/lib/workbuddy-options.mjs'

const readText=path=>readFile(path,'utf8').catch(error=>error?.code==='ENOENT'?'':Promise.reject(error))
const providerName=provider=>provider==='deepseek'?'DeepSeek Responses API':'OpenAI 兼容 Responses API'

function publicView(status,available=true){
 const model=status.model
 return{available,enabled:model.enabled,provider:model.provider,providerName:providerName(model.provider),apiUrl:model.endpoint??'',model:model.model??(model.provider==='deepseek'?'deepseek-flash':''),transcriptionModel:model.transcriptionModel??'',hasApiKey:model.apiKeyConfigured,ocrEnabled:model.ocrEnabled,transcriptionEnabled:model.transcriptionEnabled}
}

function existingMail(env){
 if(env.NOTIFICATION_DRIVER==='smtp')return{mode:'smtp',smtpUrl:env.SMTP_URL??'',from:env.MAIL_FROM??''}
 return{mode:'local'}
}

export function optionalConfigAvailable(env=process.env){return Boolean(env.OPTIONAL_CONFIG_PATH)}

export async function readAssistantAdminConfig(env=process.env){
 if(!env.OPTIONAL_CONFIG_PATH)return publicView(publicOptionalStatus(env),false)
 const managed=parseManagedEnvironment(await readText(env.OPTIONAL_CONFIG_PATH))
 return publicView(publicOptionalStatus(managed),true)
}

export async function saveAssistantAdminConfig(input,env=process.env){
 const envPath=env.OPTIONAL_CONFIG_PATH
 if(!envPath)throw new Error('当前启动方式不支持在页面中修改模型配置')
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('配置格式无效')
 const provider=input.provider==='deepseek'?'deepseek':input.provider==='openai-compatible'?'openai-compatible':null
 if(!provider)throw new Error('请选择有效的模型服务')
 if(typeof input.enabled!=='boolean')throw new Error('启用状态无效')
 const currentText=await readText(envPath),current=parseManagedEnvironment(currentText)
 const key=String(input.apiKey??'').trim()||current.ASSISTANT_API_KEY||''
 const model=input.enabled?{
  enabled:true,
  provider,
  apiUrl:provider==='deepseek'?'https://api.deepseek.com':String(input.apiUrl??'').trim(),
  apiKey:key,
  model:String(input.model??'').trim(),
  transcriptionModel:provider==='deepseek'?'':String(input.transcriptionModel??'').trim(),
 }:{enabled:false,provider}
 const options=validateWorkBuddyOptions({model,mail:existingMail(current)})
 const nextEnvironment=managedEnvironment(options),nextText=mergeManagedEnvironment(currentText,nextEnvironment)
 await mkdir(dirname(envPath),{recursive:true,mode:0o700})
 const backupRoot=env.OPTIONAL_CONFIG_BACKUP_ROOT
 if(currentText&&backupRoot){await mkdir(backupRoot,{recursive:true,mode:0o700});const backup=join(backupRoot,`page-before-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}.env`);await copyFile(envPath,backup);await chmod(backup,0o600)}
 const temporary=`${envPath}.${randomUUID()}.tmp`
 await writeFile(temporary,nextText,{mode:0o600});await chmod(temporary,0o600);await rename(temporary,envPath);await chmod(envPath,0o600)
 const info=await lstat(envPath);if((info.mode&0o777)!==0o600)throw new Error('模型配置文件权限校验失败')
 return publicView(publicOptionalStatus(nextEnvironment),true)
}

export function requestLocalRestart(env=process.env){
 const socketPath=env.LOCAL_CONTROL_SOCKET,token=env.LOCAL_CONTROL_TOKEN
 if(!socketPath||!token)return Promise.resolve(false)
 return new Promise((resolve,reject)=>{const call=request({socketPath,path:'/restart',method:'POST',headers:{'x-quexin-token':token},timeout:2000},response=>{response.resume();response.once('end',()=>response.statusCode===200?resolve(true):reject(new Error('本地重启请求被拒绝')))});call.once('error',reject);call.once('timeout',()=>call.destroy(new Error('本地重启请求超时')));call.end()})
}
