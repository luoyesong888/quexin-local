import {spawn} from 'node:child_process'
import {createHash} from 'node:crypto'
import {access,appendFile,chmod,mkdir,readFile,rm,writeFile} from 'node:fs/promises'
import {dirname,join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {collectPreflight} from './lib/workbuddy-preflight.mjs'

const project=resolve(dirname(fileURLToPath(import.meta.url)),'..'),dataRoot=resolve(process.env.QUEXIN_LOCAL_DATA??join(project,'.local-data')),runtime=join(dataRoot,'runtime'),configPath=join(runtime,'config.json'),action=process.argv[2]??'help',yes=process.argv.includes('--yes'),localRuntime=join(project,'scripts/local-runtime.mjs')
const port=(name,fallback)=>{const parsed=Number(process.env[name]??fallback);return Number.isInteger(parsed)?parsed:fallback},ports=[port('WEB_PORT',4188),port('LOCAL_API_PORT',4193),port('LOCAL_MOCK_PORT',4191),port('LOCAL_PG_PORT',5543)]
const exists=path=>access(path).then(()=>true).catch(()=>false)
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const safe=text=>String(text).replace(/postgres(?:ql)?:\/\/[^\s]+/g,'[数据库连接已隐藏]').replace(/((?:api[_-]?key|token|secret|password))=\S+/gi,'$1=[已隐藏]')
async function run(command,args,options={}){
  return new Promise((resolve,reject)=>{const child=spawn(command,args,{cwd:project,env:process.env,stdio:options.capture?['ignore','pipe','pipe']:'inherit'});let stdout='',stderr='';if(options.capture){child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk)}child.once('error',reject);child.once('exit',code=>{if(code===0)return resolve({stdout,stderr});reject(new Error(safe(stderr||stdout||`${command} 退出码 ${code}`)))})})
}
const local=(name,capture=false)=>run(process.execPath,[localRuntime,name],{capture})
const render=result=>{console.log('鹊信 · WorkBuddy 本地部署检查');for(const check of result.checks){console.log(`${check.status==='pass'?'✓':check.status==='warning'?'!':'×'} ${check.message}`);if(check.status!=='pass'&&check.remediation)console.log(`  建议：${check.remediation}`)}console.log(`结果：${result.ok?'可继续':'已阻止'} · ${result.summary.passed} 通过 / ${result.summary.warnings} 提醒 / ${result.summary.errors} 错误`)}
async function preflight(){const result=await collectPreflight({projectRoot:project,dataRoot,ports});return result}
async function acquire(){
  await mkdir(runtime,{recursive:true,mode:0o700});await chmod(runtime,0o700)
  const path=join(runtime,'workbuddy-deploy.lock')
  try{await mkdir(path,{mode:0o700})}catch(error){if(error.code!=='EEXIST')throw error;let owner=null;try{owner=JSON.parse(await readFile(join(path,'owner.json'),'utf8'))}catch{}let alive=false;if(Number.isInteger(owner?.pid)&&owner.pid>1)try{process.kill(owner.pid,0);alive=true}catch{}if(alive)throw new Error(`另一个 WorkBuddy 部署操作仍在运行（PID ${owner.pid}）`);await rm(path,{recursive:true,force:true});await mkdir(path,{mode:0o700})}
  await writeFile(join(path,'owner.json'),JSON.stringify({pid:process.pid,action,startedAt:new Date().toISOString()},null,2)+'\n',{mode:0o600});return async()=>rm(path,{recursive:true,force:true})
}
async function audit(status,details={}){await mkdir(runtime,{recursive:true,mode:0o700});await appendFile(join(runtime,'workbuddy-deploy.log'),JSON.stringify({time:new Date().toISOString(),action,status,...details})+'\n',{mode:0o600})}
async function verify(){
  if(!await exists(configPath))throw new Error('尚未初始化，先运行 install --yes')
  const config=JSON.parse(await readFile(configPath,'utf8')),deadline=Date.now()+15_000
  while(Date.now()<deadline)try{const response=await fetch(`http://127.0.0.1:${config.apiPort}/health`,{signal:AbortSignal.timeout(1200)}),body=await response.json();if(response.ok&&body?.data?.status==='ready'){const state=await local('status',true);console.log(state.stdout.trim());console.log(`✓ 健康检查通过：http://127.0.0.1:${config.webPort}/`);return{url:`http://127.0.0.1:${config.webPort}/`}}}catch{}finally{await sleep(250)}
  throw new Error('服务未在 15 秒内通过数据库就绪检查，请运行 doctor 查看原因')
}
async function install(){
  const before=await preflight();render(before);if(!before.ok)throw new Error('预检存在错误，安装已停止且未修改资料')
  if(!yes){console.log('\n将执行：安装锁定依赖（如缺失）→ 保留/初始化独立数据库 → 启动五个组件 → 健康检查。');console.log('确认后由 WorkBuddy 运行：node scripts/workbuddy-deploy.mjs install --yes');process.exitCode=2;return}
  const release=await acquire(),hadConfig=await exists(configPath)
  try{
    await audit('started',{existingData:hadConfig})
    if(!before.environment.dependenciesInstalled){console.log('正在安装 package-lock.json 锁定的依赖…');await run('npm',['ci'])}
    console.log(hadConfig?'检测到现有资料：保留数据库与密钥，不重新初始化。':'正在创建独立本地数据库和随机密钥…')
    await local('init');await local('start');const checked=await verify(),lockHash=createHash('sha256').update(await readFile(join(project,'package-lock.json'))).digest('hex')
    await writeFile(join(runtime,'workbuddy-install.json'),JSON.stringify({format:'quexin-workbuddy-install-v1',installedAt:new Date().toISOString(),node:process.version,lockSha256:lockHash,existingDataPreserved:hadConfig,url:checked.url},null,2)+'\n',{mode:0o600})
    await audit('completed',{existingDataPreserved:hadConfig});console.log('✓ WorkBuddy 本地部署完成。重复运行 install --yes 不会重置资料。')
  }catch(error){await audit('failed',{message:safe(error.message)}).catch(()=>{});throw error}finally{await release()}
}
async function backup(){
  if(!await exists(configPath))throw new Error('尚未初始化，没有可备份的服务端资料')
  if(!yes){console.log('备份会短暂停止鹊信，完成后恢复原运行状态。');console.log('确认后由 WorkBuddy 运行：node scripts/workbuddy-deploy.mjs backup --yes');process.exitCode=2;return}
  const before=await preflight(),wasRunning=before.environment.runtimeRunning,release=await acquire()
  try{await audit('started',{wasRunning});if(wasRunning)await local('stop');await local('backup');if(wasRunning)await local('start');await audit('completed',{restarted:wasRunning});console.log('✓ 备份完成。浏览器私人资料仍需在“系统 → 数据与备份”单独导出。')}
  catch(error){if(wasRunning)await local('start').catch(()=>{});await audit('failed',{message:safe(error.message)}).catch(()=>{});throw error}finally{await release()}
}
async function restoreBackup(){
  if(!await exists(configPath))throw new Error('尚未初始化，不能恢复服务端备份')
  const input=process.argv.indexOf('--backup'),folder=input>=0&&process.argv[input+1]?resolve(process.argv[input+1]):'';if(!folder)throw new Error('需要 --backup <完整备份目录>')
  if(!yes){console.log(`恢复计划：验证备份 → 停止鹊信 → 恢复到新数据库 → 启动并健康检查。原数据库和原文件保留。\n备份：${folder}`);console.log('确认后添加 --yes。');process.exitCode=2;return}
  const before=await preflight(),wasRunning=before.environment.runtimeRunning,release=await acquire()
  try{await audit('started',{wasRunning,restore:true});if(wasRunning)await local('stop');await run(process.execPath,[localRuntime,'restore',folder]);await local('start');await verify();if(!wasRunning)await local('stop');await audit('completed',{restore:true,restarted:wasRunning});console.log('✓ 服务端备份已恢复到新数据库，原数据库和原文件仍保留。')}
  catch(error){if(wasRunning)await local('start').catch(()=>{});await audit('failed',{restore:true,message:safe(error.message)}).catch(()=>{});throw error}finally{await release()}
}
async function main(){
  if(action==='help'||!['check','install','start','status','doctor','backup','restore','stop','verify','config','upgrade','rollback','uninstall','purge-data'].includes(action)){console.log('用法：node scripts/workbuddy-deploy.mjs <check|install|start|status|doctor|backup|restore|stop|verify|config|upgrade|rollback|uninstall|purge-data> [参数]');return}
  if(action==='check'){render(await preflight());return}
  if(action==='install'){await install();return}
  if(action==='config'){await run(process.execPath,[join(project,'scripts/workbuddy-config.mjs'),...process.argv.slice(3)]);return}
  if(['upgrade','rollback','uninstall','purge-data'].includes(action)){await run(process.execPath,[join(project,'scripts/workbuddy-lifecycle.mjs'),action,...process.argv.slice(3)]);return}
  if(action==='backup'){await backup();return}
  if(action==='restore'){await restoreBackup();return}
  if(action==='start'){if(!await exists(configPath))throw new Error('尚未安装，先运行 install --yes');await local('start');await verify();return}
  if(action==='verify'){await verify();return}
  if(action==='status'){const result=await local('status',true);console.log(result.stdout.trim());return}
  if(action==='doctor'){if(!await exists(configPath))throw new Error('尚未初始化；可以先运行 check');await run(process.execPath,[join(project,'scripts/production-doctor.mjs'),'--local']);return}
  if(action==='stop'){await local('stop');return}
}

try{await main()}catch(error){console.error(`WorkBuddy 部署：${safe(error instanceof Error?error.message:String(error))}`);process.exitCode=1}
