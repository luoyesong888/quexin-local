import {spawn} from 'node:child_process'
import {access,chmod,lstat,mkdir,readFile,rename,rm,writeFile} from 'node:fs/promises'
import {dirname,join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {managedEnvironment,mergeManagedEnvironment,parseManagedEnvironment,publicOptionalStatus,validateWorkBuddyOptions} from './lib/workbuddy-options.mjs'

const project=resolve(dirname(fileURLToPath(import.meta.url)),'..'),dataRoot=resolve(process.env.QUEXIN_LOCAL_DATA??join(project,'.local-data')),runtime=join(dataRoot,'runtime'),configPath=join(runtime,'config.json'),envPath=join(project,'.env.local'),action=process.argv[2]??'status',yes=process.argv.includes('--yes'),json=process.argv.includes('--json'),after=flag=>{const index=process.argv.indexOf(flag);return index>=0?process.argv[index+1]:''}
const exists=path=>access(path).then(()=>true).catch(()=>false),safe=value=>String(value).replace(/((?:api[_-]?key|token|secret|password))=\S+/gi,'$1=[已隐藏]').replace(/(?:smtp|smtps|https?):\/\/[^\s]+/gi,'[服务地址已隐藏]')
const run=(command,args,capture=false)=>new Promise((resolve,reject)=>{
  const child=spawn(command,args,{cwd:project,env:process.env,stdio:capture?['ignore','pipe','pipe']:'inherit'});let stdout='',stderr=''
  if(capture){child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk)}
  child.once('error',reject);child.once('exit',code=>code===0?resolve({stdout,stderr}):reject(new Error(safe(stderr||stdout||`退出码 ${code}`))))
})
const local=(name,capture=false)=>run(process.execPath,[join(project,'scripts/local-runtime.mjs'),name],capture)
async function readStdin(){let text='';for await(const chunk of process.stdin)text+=chunk;return text}
async function inputOptions(){const input=after('--input');if(!input)throw new Error('需要 --input <权限为 600 的 JSON 文件|->');let text;if(input==='-')text=await readStdin();else{const path=resolve(input),info=await lstat(path);if(info.isSymbolicLink()||!info.isFile())throw new Error('配置输入必须是普通文件，不能是符号链接');if((info.mode&0o077)!==0)throw new Error('配置输入权限过宽，请先 chmod 600');text=await readFile(path,'utf8')}let parsed;try{parsed=JSON.parse(text)}catch{throw new Error('配置输入不是有效 JSON')}return validateWorkBuddyOptions(parsed)}
async function current(){const text=await readFile(envPath,'utf8').catch(error=>error.code==='ENOENT'?'':Promise.reject(error)),env=parseManagedEnvironment(text),info=await lstat(envPath).catch(()=>null);return{exists:Boolean(info),mode:info?info.mode&0o777:null,status:publicOptionalStatus(env),text}}
function show(status){if(json)console.log(JSON.stringify(status,null,2));else{console.log(`模型：${status.model.enabled?`已配置 · ${status.model.model} · ${status.model.endpoint}`:'未配置，使用本地检索'}`);console.log(`OCR：${status.model.ocrEnabled?'使用已配置模型，识别后仍需人工确认':'人工文字模式'}`);console.log(`录音转写：${status.model.transcriptionEnabled?`已配置 · ${status.model.transcriptionModel}`:'未配置，使用人工文字'}`);console.log(`邮件：${status.mail.mode==='smtp'?`SMTP 已配置 · ${status.mail.endpoint} · ${status.mail.from}`:'本地 outbox，不连接外部邮箱'}`)}}
async function runtimeRunning(){try{const state=JSON.parse(await readFile(join(runtime,'state.json'),'utf8'));if(Number.isInteger(state.pid)&&state.pid>1){process.kill(state.pid,0);return true}}catch{}return false}
async function acquire(){await mkdir(runtime,{recursive:true,mode:0o700});const path=join(runtime,'workbuddy-deploy.lock');try{await mkdir(path,{mode:0o700})}catch(error){if(error.code!=='EEXIST')throw error;let owner=null;try{owner=JSON.parse(await readFile(join(path,'owner.json'),'utf8'))}catch{}let alive=false;if(Number.isInteger(owner?.pid)&&owner.pid>1)try{process.kill(owner.pid,0);alive=true}catch{}if(alive)throw new Error(`另一个 WorkBuddy 操作仍在运行（PID ${owner.pid}）`);await rm(path,{recursive:true,force:true});await mkdir(path,{mode:0o700})}await writeFile(join(path,'owner.json'),JSON.stringify({pid:process.pid,action:'config',startedAt:new Date().toISOString()})+'\n',{mode:0o600});return()=>rm(path,{recursive:true,force:true})}
async function writeAtomic(text){const temporary=envPath+'.workbuddy.tmp';await writeFile(temporary,text,{mode:0o600});await chmod(temporary,0o600);await rename(temporary,envPath)}
async function verify(expected){const config=JSON.parse(await readFile(configPath,'utf8')),deadline=Date.now()+15_000;while(Date.now()<deadline){try{const response=await fetch(`http://127.0.0.1:${config.apiPort}/health`,{signal:AbortSignal.timeout(1000)}),body=await response.json();if(response.ok&&body?.data?.status==='ready'){const capabilities=body.data.capabilities??{};if(Boolean(capabilities.assistant)!==expected.model.enabled||Boolean(capabilities.transcription)!==Boolean(expected.model.enabled&&expected.model.transcriptionModel))throw new Error('服务已启动，但可选能力状态与配置不一致');await new Promise(resolve=>setTimeout(resolve,800));const state=await local('status',true);for(const name of ['模拟 API','本机账号 API','网页','后台维护','通知投递'])if(!state.stdout.includes(`✓ ${name}`))throw new Error(`服务已启动，但组件未保持运行：${name}`);return}}catch(error){if(/能力状态|组件未保持/.test(String(error.message)))throw error}await new Promise(resolve=>setTimeout(resolve,250))}throw new Error('新配置未能通过服务健康检查')}
async function apply(options){
  if(!await exists(configPath))throw new Error('鹊信尚未安装，先运行 WorkBuddy install --yes')
  const previous=await current(),nextEnv=managedEnvironment(options),nextText=mergeManagedEnvironment(previous.text,nextEnv),nextStatus=publicOptionalStatus(nextEnv);show(nextStatus)
  if(!yes){console.log('以上配置尚未写入。确认后运行同一命令并添加 --yes。');process.exitCode=2;return}
  const release=await acquire(),wasRunning=await runtimeRunning(),backupDir=join(runtime,'optional-config-backups'),stamp=new Date().toISOString().replace(/[:.]/g,'-'),backupPath=join(backupDir,`${stamp}.env`)
  try{
    await mkdir(backupDir,{recursive:true,mode:0o700});if(previous.exists)await writeFile(backupPath,previous.text,{mode:0o600})
    if(wasRunning)await local('stop');await writeAtomic(nextText)
    if(wasRunning){try{await local('start');await verify(options)}catch(error){await local('stop').catch(()=>{});if(previous.exists)await writeAtomic(previous.text);else await rm(envPath,{force:true});await local('start').catch(()=>{});throw new Error(`新配置启动失败，已恢复旧配置：${safe(error.message)}`)}}
    console.log(`✓ 可选能力配置已保存${wasRunning?'并重启验证':''}。${previous.exists?`旧配置备份：${backupPath.replace(project,'[项目目录]')}`:'之前没有 .env.local。'}`)
  }finally{await release()}
}
async function main(){
  if(action==='status'){const value=await current();show({...value.status,configFile:value.exists?'存在':'不存在',permissions:value.mode??null});return}
  if(!['plan','apply'].includes(action)){console.log('用法：node scripts/workbuddy-config.mjs <status|plan|apply> [--input 文件|-] [--yes] [--json]');return}
  const options=await inputOptions();if(action==='plan'){show(publicOptionalStatus(managedEnvironment(options)));console.log('只显示计划，未写入任何文件。');return}await apply(options)
}
try{await main()}catch(error){console.error(`WorkBuddy 配置：${safe(error instanceof Error?error.message:String(error))}`);process.exitCode=1}
