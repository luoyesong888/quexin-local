import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {access,lstat,readFile,readdir,statfs} from 'node:fs/promises'
import {createServer} from 'node:net'
import {dirname,join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {release as kernelRelease} from 'node:os'

const exec=promisify(execFile),gib=1024**3
const atLeast=(version,minimum)=>{const left=String(version??'').replace(/^v/,'').split('.').map(Number),right=minimum.split('.').map(Number);for(let index=0;index<3;index++){if((left[index]??0)>(right[index]??0))return true;if((left[index]??0)<(right[index]??0))return false}return true}
const major=version=>Number(String(version??'').match(/(\d+)(?:\.\d+)?/)?.[1]??0)
const item=(id,status,message,remediation='')=>({id,status,message,...(remediation?{remediation}:{})})

export function evaluatePreflight(input){
  const checks=[],add=(...args)=>checks.push(item(...args))
  const wsl=input.platform==='linux'&&input.isWSL===true,supported=input.platform==='darwin'||wsl
  add('platform',supported?'pass':'error',input.platform==='darwin'?'macOS 支持':wsl?'Windows WSL2 运行路径（预览）':'请在 macOS 或 Windows 的 WSL2 Ubuntu 内运行','原生 Windows Node 环境不受支持；请使用 Windows + WSL2 专用部署包。')
  if(wsl){
    add('runtime-user',input.isRoot?'error':'pass',input.isRoot?'不能用 root 初始化本地 PostgreSQL':'使用普通 WSL 用户','先完成 Ubuntu 普通用户设置，再运行安装；不要 sudo 整个安装器。')
    add('linux-storage',input.windowsMountedPath||input.dataSymlink?'error':'pass',input.windowsMountedPath||input.dataSymlink?'程序/数据位于 Windows 挂载盘，或数据目录为链接':'程序与资料位于 Linux 文件系统','请使用 /home/用户名/ 下的真实目录，不能把数据库和交换箱放在 /mnt/c 等 Windows 挂载目录。')
    add('wsl-host-validation','warning','需在 Windows 浏览器验证本机访问；本包尚无 Windows 实机验收记录','启动后用 Windows 的 Edge/Chrome 打开安装器输出的网址。')
  }
  add('architecture',['arm64','x64'].includes(input.arch)?'pass':'error',`CPU 架构：${input.arch||'未知'}`,'需要 arm64 或 x64。')
  add('node',atLeast(input.nodeVersion,'22.12.0')?'pass':'error',`Node.js：${input.nodeVersion||'未找到'}`,'安装 Node.js 22.12 或更新版本后重新检查。')
  add('npm',input.npmVersion?'pass':'error',`npm：${input.npmVersion||'未找到'}`,'Node.js 安装应同时提供 npm。')
  add('postgres',major(input.postgresVersion)===17&&input.postgresToolsComplete?'pass':'error',input.postgresVersion?`PostgreSQL：${input.postgresVersion}${input.postgresToolsComplete?'':'，工具不完整'}`:'PostgreSQL 17：未找到','安装 PostgreSQL 17，或设置 PG_BIN 指向包含 pg_ctl/initdb/pg_dump/pg_restore 的 bin 目录。')
  add('browser',input.browser||wsl?'pass':'error',wsl?'使用 Windows 宿主机浏览器':`桌面浏览器：${input.browser||'未找到'}`,'需要 Safari、Edge、Chrome、Chromium 或 Firefox 桌面浏览器。')
  for(const file of input.requiredFiles??[])add(`file:${file.name}`,file.exists?'pass':'error',file.exists?`必需文件存在：${file.name}`:`缺少必需文件：${file.name}`,'请使用完整、校验通过的鹊信发布包。')
  add('dependencies',input.dependenciesInstalled?'pass':'warning',input.dependenciesInstalled?'npm 依赖已安装':'npm 依赖尚未安装','后续由 WorkBuddy 在用户确认后运行 npm ci；预检不会安装。')
  const free=Number(input.diskFreeBytes??0);add('disk',free>=gib?(free>=5*gib?'pass':'warning'):'error',`可用磁盘：${(free/gib).toFixed(1)} GiB`,free<gib?'至少释放 1 GiB；建议为照片和备份保留 5 GiB。':'建议为照片和备份保留至少 5 GiB。')
  for(const port of input.ports??[])add(`port:${port.port}`,port.free?'pass':input.runtimeRunning?'warning':'error',`端口 ${port.port}：${port.free?'可用':input.runtimeRunning?'当前鹊信正在使用':'被其他程序占用'}`,port.free?'':input.runtimeRunning?'升级或重新安装前先运行 npm run local:stop。':`关闭占用 ${port.port} 的程序，或在安装前选择其他端口。`)
  if(input.dataExists)add('existing-data','warning','发现已有 .local-data，部署流程必须保留并先备份','不要删除或重新初始化；先运行本地备份和状态检查。');else add('existing-data','pass','未发现旧数据，将使用全新独立数据目录')
  if(input.dataSymlink)add('data-symlink','warning','数据目录是符号链接','确认链接目标属于当前用户且备份覆盖真实位置。')
  if(input.dataMode!==null&&input.dataMode!==undefined)add('data-permissions',(input.dataMode&0o077)===0?'pass':'warning',`数据目录权限：${input.dataMode.toString(8)}`,'建议目录权限为 700，仅当前系统用户可访问。')
  const summary={passed:checks.filter(value=>value.status==='pass').length,warnings:checks.filter(value=>value.status==='warning').length,errors:checks.filter(value=>value.status==='error').length}
  return{ok:summary.errors===0,target:wsl?'Windows WSL2 local preview':input.platform==='darwin'?'macOS local':'unsupported',readOnly:true,summary,checks}
}

const command=async(executable,args=[])=>{try{return(await exec(executable,args,{timeout:5000})).stdout.trim()}catch{return''}}
const exists=path=>access(path).then(()=>true).catch(()=>false)
const portFree=port=>new Promise(resolve=>{const server=createServer();server.once('error',()=>resolve(false));server.listen(port,'127.0.0.1',()=>server.close(()=>resolve(true)))})
async function postgres(){
  const candidates=[process.env.PG_BIN,'/opt/homebrew/opt/postgresql@17/bin','/usr/local/opt/postgresql@17/bin','/Applications/Postgres.app/Contents/Versions/17/bin','/usr/lib/postgresql/17/bin'].filter(Boolean)
  let bin=''
  for(const candidate of candidates)if(await exists(join(candidate,'pg_ctl'))){bin=candidate;break}
  if(!bin){const found=await command('which',['pg_ctl']);if(found)bin=dirname(found)}
  if(!bin)return{version:'',complete:false,bin:''}
  const tools=['pg_ctl','initdb','pg_dump','pg_restore'],complete=(await Promise.all(tools.map(tool=>exists(join(bin,tool))))).every(Boolean),version=await command(join(bin,'pg_ctl'),['--version'])
  return{version,complete,bin}
}

export async function collectPreflight(options={}){
  const environmentPort=(name,fallback)=>{const value=Number(process.env[name]??fallback);return Number.isInteger(value)&&value>=1024&&value<=65535?value:fallback},projectRoot=resolve(options.projectRoot??dirname(dirname(dirname(fileURLToPath(import.meta.url))))),dataRoot=resolve(options.dataRoot??process.env.QUEXIN_LOCAL_DATA??join(projectRoot,'.local-data')),ports=options.ports??[environmentPort('WEB_PORT',4188),environmentPort('LOCAL_API_PORT',4193),environmentPort('LOCAL_MOCK_PORT',4191),environmentPort('LOCAL_PG_PORT',5543)]
  const pg=await postgres(),npmVersion=await command('npm',['--version']),osVersion=process.platform==='darwin'?await command('sw_vers',['-productVersion']):await command('uname',['-r']),statePath=join(dataRoot,'runtime/state.json'),runtimeState=await exists(statePath),dataExists=await exists(dataRoot)
  let runtimeRunning=false
  if(runtimeState)try{const state=JSON.parse(await readFile(statePath,'utf8'));if(Number.isInteger(state.pid)&&state.pid>1){process.kill(state.pid,0);runtimeRunning=true}}catch{}
  let dataMode=null,dataSymlink=false
  if(dataExists){const info=await lstat(dataRoot);dataMode=info.mode&0o777;dataSymlink=info.isSymbolicLink()}
  const required=['package.json','package-lock.json','DEPLOY_WITH_WORKBUDDY.md','WorkBuddy部署检查.command','scripts/workbuddy-deploy.mjs','scripts/local-runtime.mjs','server/prod-server.mjs','server/migrate.mjs','release/local-release-spec.json'],requiredFiles=await Promise.all(required.map(async name=>({name,exists:await exists(join(projectRoot,name))}))),disk=await statfs(dataExists?dataRoot:projectRoot)
  const browsers=[['Safari','/System/Applications/Safari.app'],['Safari','/Applications/Safari.app'],['Chrome','/Applications/Google Chrome.app'],['Chromium','/Applications/Chromium.app'],['Firefox','/Applications/Firefox.app']],foundBrowsers=[]
  for(const [name,path] of browsers)if(await exists(path)&&!foundBrowsers.includes(name))foundBrowsers.push(name)
  const isWSL=process.platform==='linux'&&(/microsoft/i.test(kernelRelease())||Boolean(process.env.WSL_INTEROP||process.env.WSL_DISTRO_NAME))
  const input={platform:process.platform,isWSL,isRoot:process.getuid?.()===0,windowsMountedPath:[projectRoot,dataRoot].some(path=>/^\/mnt\/[a-z](?:\/|$)/i.test(path)),arch:process.arch,osVersion,nodeVersion:process.version,npmVersion,postgresVersion:pg.version,postgresToolsComplete:pg.complete,postgresBin:pg.bin,browser:foundBrowsers.join(' / '),requiredFiles,dependenciesInstalled:await exists(join(projectRoot,'node_modules/.package-lock.json')),diskFreeBytes:disk.bavail*disk.bsize,ports:await Promise.all(ports.map(async port=>({port,free:await portFree(port)}))),runtimeRunning,dataExists,dataMode,dataSymlink}
  return{...evaluatePreflight(input),environment:{platform:input.platform,architecture:input.arch,osVersion,nodeVersion:input.nodeVersion,npmVersion:input.npmVersion,postgresVersion:input.postgresVersion?input.postgresVersion.replace(/^.*?PostgreSQL\)?\s*/,''):null,postgresBin:input.postgresBin?input.postgresBin.replace(projectRoot,'[项目目录]'):null,browser:input.browser||null,projectRoot,dataRoot:dataRoot.replace(projectRoot,'[项目目录]'),dependenciesInstalled:input.dependenciesInstalled,runtimeRunning,dataExists}}
}
