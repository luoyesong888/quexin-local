import {spawn,execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {createServer as httpServer,request} from 'node:http'
import {createServer as tcpServer} from 'node:net'
import {access,mkdir,readFile,writeFile,rename,rm,open,readdir,copyFile,lstat,chmod} from 'node:fs/promises'
import {resolve,join,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {tmpdir} from 'node:os'
import {randomBytes,createHash} from 'node:crypto'
import pg from 'pg'
import {managedKeys} from './lib/workbuddy-options.mjs'

const exec=promisify(execFile),project=resolve(dirname(fileURLToPath(import.meta.url)),'..')
process.chdir(project)
const optionalConfigPath=resolve(process.env.OPTIONAL_CONFIG_PATH??'.env.local')
try{process.loadEnvFile(optionalConfigPath)}catch(error){if(error?.code!=='ENOENT')throw error}
const dataRoot=resolve(process.env.QUEXIN_LOCAL_DATA??'.local-data'),runtime=join(dataRoot,'runtime'),configPath=join(runtime,'config.json'),legacySocketPath=join(runtime,'control.sock'),socketPath=join(tmpdir(),`quexin-control-${createHash('sha256').update(dataRoot).digest('hex').slice(0,20)}.sock`)
const action=process.argv[2]??'status',argument=process.argv[3]
const exists=p=>access(p).then(()=>true).catch(()=>false)
const pause=ms=>new Promise(r=>setTimeout(r,ms))
const json=p=>readFile(p,'utf8').then(JSON.parse)
async function privateJson(path,value){await mkdir(dirname(path),{recursive:true,mode:0o700});const temp=path+'.tmp';await writeFile(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600});await chmod(temp,0o600);await rename(temp,path)}
async function secureDirectories(c){for(const path of [dataRoot,runtime,c.mediaRoot,c.exportRoot,join(dataRoot,'notification-outbox')]){await mkdir(path,{recursive:true,mode:0o700});await chmod(path,0o700)}}
async function config(){
 if(!await exists(configPath))throw Error('尚未初始化。先运行 npm run local:init；已有数据库可按本地使用说明接入。')
 const value=await json(configPath)
 if(typeof value.capsuleKey!=='string'||!value.capsuleKey){value.capsuleKey=randomBytes(32).toString('hex');await privateJson(configPath,value)}
 return value
}
function port(value,fallback){const n=Number(value??fallback);if(!Number.isInteger(n)||n<1024||n>65535)throw Error('端口必须为 1024–65535 的整数');return n}
async function free(port){return new Promise(resolve=>{const s=tcpServer();s.once('error',()=>resolve(false));s.listen(port,'127.0.0.1',()=>s.close(()=>resolve(true)))})}
async function freeServices(c){for(const p of [c.webPort,c.apiPort,c.mockPort])if(!await free(p))throw Error(`端口 ${p} 已被占用。请先关闭对应的旧服务；启动器不会结束其他进程。`)}
async function binaries(){for(const p of [process.env.PG_BIN,'/opt/homebrew/opt/postgresql@17/bin','/usr/local/opt/postgresql@17/bin','/usr/lib/postgresql/17/bin'].filter(Boolean))if(await exists(join(p,'pg_ctl')))return p;try{return dirname((await exec('which',['pg_ctl'])).stdout.trim())}catch{throw Error('未找到 PostgreSQL 工具。请安装 PostgreSQL 17，或设置 PG_BIN 指向其 bin 目录。')}}
async function run(command,args,env={}){try{return await exec(command,args,{cwd:project,env:{...process.env,...env},maxBuffer:8*1024*1024})}catch(error){throw Error(`${command.split('/').pop()} 执行失败：${String(error.stderr||error.message).replace(/postgres(?:ql)?:\/\/[^\s]+/g,'[数据库连接已隐藏]').slice(-1800)}`)}}
async function sql(url,statement,params=[]){const client=new pg.Client({connectionString:url,connectionTimeoutMillis:5000});try{await client.connect();return await client.query(statement,params)}finally{await client.end()}}
async function checkDatabase(c){
 const result=await sql(c.databaseUrl,"SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user")
 if(result.rows[0].rolsuper||result.rows[0].rolbypassrls)throw Error('应用账号不能是超级用户或绕过 RLS 的角色。')
 const applied=await sql(c.databaseUrl,'SELECT name FROM quexin.schema_migrations'),files=(await readdir('server/migrations')).filter(f=>f.endsWith('.sql'))
 if(files.some(f=>!applied.rows.some(r=>r.name===f)))throw Error('数据库迁移未完成，请运行 npm run local:migrate。')
}
async function startDatabase(c){
 if(!c.pgData)return false
 try{await run(join(c.pgBin,'pg_ctl'),['-D',c.pgData,'status']);return false}catch{}
 if(!await free(c.pgPort))throw Error(`数据库端口 ${c.pgPort} 已被其他服务占用。`)
 await run(join(c.pgBin,'pg_ctl'),['-D',c.pgData,'-l',join(runtime,'postgres.log'),'-w','start']);return true
}
async function stopDatabase(c){if(c.pgData&&!c.keepDatabaseRunning)await run(join(c.pgBin,'pg_ctl'),['-D',c.pgData,'-m','fast','-w','stop'])}
async function migrate(c){await run(process.execPath,['server/migrate.mjs'],{DATABASE_URL:c.adminUrl,DATABASE_APP_ROLE:c.appRole})}
async function initialize(){
 await mkdir(runtime,{recursive:true,mode:0o700})
 if(await exists(configPath)){console.log('已有本地配置，保留现有资料。');return}
 const c={version:1,webPort:port(process.env.WEB_PORT,4188),apiPort:port(process.env.LOCAL_API_PORT,4193),mockPort:port(process.env.LOCAL_MOCK_PORT,4191),mediaRoot:join(dataRoot,'media'),exportRoot:join(dataRoot,'exports'),mockData:join(dataRoot,'mock-cloud.json'),notificationKey:process.env.NOTIFICATION_ENCRYPTION_KEY??randomBytes(32).toString('hex'),capsuleKey:process.env.CAPSULE_ENCRYPTION_KEY??randomBytes(32).toString('hex')}
 if(new Set([c.webPort,c.apiPort,c.mockPort]).size!==3)throw Error('网页与两个 API 端口必须各不相同。')
 if(argument==='--existing'){
  if(!process.env.DATABASE_URL||!process.env.MAINTENANCE_DATABASE_URL)throw Error('接入已有数据库需提供 DATABASE_URL 和 MAINTENANCE_DATABASE_URL。')
  Object.assign(c,{databaseUrl:process.env.DATABASE_URL,adminUrl:process.env.MAINTENANCE_DATABASE_URL,appRole:decodeURIComponent(new URL(process.env.DATABASE_URL).username)})
  if(process.env.EXISTING_PG_DATA)Object.assign(c,{pgData:resolve(process.env.EXISTING_PG_DATA),pgBin:await binaries(),pgPort:port(new URL(c.databaseUrl).port,5432),keepDatabaseRunning:true})
  await checkDatabase(c);await privateJson(configPath,c);console.log('已接入现有本机数据库；未替换任何资料。');return
 }
 c.pgBin=await binaries();c.pgPort=port(process.env.LOCAL_PG_PORT,5543);c.pgData=join(dataRoot,'postgres')
 if(await exists(c.pgData))throw Error('数据库目录已存在但缺少配置，已停止。请按说明恢复配置，不会重新初始化旧目录。')
 if(!await free(c.pgPort))throw Error(`端口 ${c.pgPort} 被占用，请设置 LOCAL_PG_PORT 后重试。`)
 const ownerPassword=randomBytes(24).toString('hex'),appPassword=randomBytes(24).toString('hex'),passwordFile=join(runtime,'init-password')
 c.adminUrl=`postgres://quexin_owner:${ownerPassword}@127.0.0.1:${c.pgPort}/quexin_local`;c.databaseUrl=`postgres://quexin_app:${appPassword}@127.0.0.1:${c.pgPort}/quexin_local`;c.appRole='quexin_app'
 await privateJson(join(runtime,'initialization-recovery.json'),c)
 await writeFile(passwordFile,ownerPassword+'\n',{mode:0o600})
 try{await run(join(c.pgBin,'initdb'),['-D',c.pgData,'-U','quexin_owner','--encoding=UTF8','--locale=C','--auth-local=trust','--auth-host=scram-sha-256','--pwfile='+passwordFile])}finally{await rm(passwordFile,{force:true})}
 const pgConfig=join(c.pgData,'postgresql.conf');await writeFile(pgConfig,await readFile(pgConfig,'utf8')+`\nlisten_addresses = '127.0.0.1'\nport = ${c.pgPort}\nunix_socket_directories = ''\n`)
 let started=false
 try{
  started=await startDatabase(c)
  const admin=new URL(c.adminUrl);admin.pathname='/postgres'
  await sql(admin.href,`CREATE ROLE quexin_app LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${appPassword}'`)
  await sql(admin.href,'CREATE DATABASE quexin_local OWNER quexin_owner')
  await migrate(c);await checkDatabase(c);await privateJson(configPath,c);await rm(join(runtime,'initialization-recovery.json'),{force:true})
 }finally{if(started)await stopDatabase(c)}
 console.log('独立本地数据库已初始化。运行 npm run local:start 即可打开鹊信。')
}
async function control(method='GET',token='',controlPath='/'){
 const attempt=path=>new Promise((resolve,reject)=>{const r=request({socketPath:path,path:controlPath,method,headers:{'x-quexin-token':token},timeout:1500},res=>{let data='';res.on('data',chunk=>data+=chunk);res.on('end',()=>{try{if(res.statusCode!==200)throw Error('控制请求被拒绝');resolve(JSON.parse(data))}catch(e){reject(e)}})});r.on('error',reject);r.on('timeout',()=>r.destroy(Error('控制接口超时')));r.end()})
 let error
 for(const path of [...new Set([socketPath,legacySocketPath])])try{return await attempt(path)}catch(cause){error=cause}
 throw error
}
async function status(){try{return await control()}catch{return null}}
async function ready(url){try{return (await fetch(url,{signal:AbortSignal.timeout(1000)})).ok}catch{return false}}
async function serve(){
 const c=await config(),children=[],components=[],token=randomBytes(24).toString('hex');let stopping=false,dbStarted=false,server
 await secureDirectories(c)
 const lock=join(runtime,'running.lock');await mkdir(lock)
 await privateJson(join(lock,'owner.json'),{pid:process.pid})
 async function shutdown(code=0,restart=false){
  if(stopping)return;stopping=true
  for(const child of children)if(child.exitCode===null)child.kill('SIGTERM')
  await Promise.all(children.map(child=>new Promise(resolve=>{if(child.exitCode!==null)return resolve();const timeout=setTimeout(()=>{child.kill('SIGKILL');resolve()},4000);child.once('exit',()=>{clearTimeout(timeout);resolve()})})))
  if(dbStarted)await stopDatabase(c).catch(e=>console.error(e.message))
  if(server)await new Promise(resolve=>server.close(resolve));await rm(socketPath,{force:true});await rm(legacySocketPath,{force:true});await rm(join(runtime,'state.json'),{force:true});await rm(lock,{recursive:true,force:true})
  if(restart){const restartEnv={...process.env};for(const key of managedKeys)delete restartEnv[key];const log=await open(join(runtime,'service.log'),'a',0o600);const next=spawn(process.execPath,[fileURLToPath(import.meta.url),'start'],{cwd:project,detached:true,stdio:['ignore',log.fd,log.fd],env:restartEnv});next.unref();await log.close()}
  process.exit(code)
 }
 for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>void shutdown())
 const child=(name,args,env={})=>{const p=spawn(process.execPath,args,{cwd:project,stdio:['ignore','inherit','inherit'],env:{...process.env,...env}});children.push(p);components.push({name,pid:p.pid,process:p});p.on('error',e=>{console.error(`${name} 启动失败：${e.message}`);void shutdown(1)});p.on('exit',code=>{if(!stopping){console.error(`${name} 已退出 (${code})，正在停止其余服务。`);void shutdown(1)}});return p}
 try{
  await freeServices(c);dbStarted=await startDatabase(c);await checkDatabase(c)
  const origin=`http://127.0.0.1:${c.webPort}`
  child('模拟 API',['server/mock-server.mjs','--port',String(c.mockPort),'--data',c.mockData])
  child('本机账号 API',['server/prod-server.mjs','--port',String(c.apiPort),'--host','127.0.0.1'],{DATABASE_URL:c.databaseUrl,PUBLIC_ORIGIN:origin,DEV_MAILBOX:'true',NOTIFICATION_ENCRYPTION_KEY:c.notificationKey,CAPSULE_ENCRYPTION_KEY:c.capsuleKey??`${c.notificationKey}-capsule`,MEDIA_ROOT:c.mediaRoot,EXPORT_ROOT:c.exportRoot,OPTIONAL_CONFIG_PATH:optionalConfigPath,OPTIONAL_CONFIG_BACKUP_ROOT:join(runtime,'optional-config-backups'),LOCAL_CONTROL_SOCKET:socketPath,LOCAL_CONTROL_TOKEN:token})
  child('网页',['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(c.webPort),'--strictPort'],{WEB_PORT:String(c.webPort),FORMAL_API_TARGET:`http://127.0.0.1:${c.apiPort}`,MOCK_API_TARGET:`http://127.0.0.1:${c.mockPort}`})
  if(process.env.DISABLE_BACKGROUND_WORKERS!=='true'){
   child('后台维护',['server/maintenance.mjs'],{MAINTENANCE_DATABASE_URL:c.adminUrl,MAINTENANCE_INTERVAL_MS:process.env.MAINTENANCE_INTERVAL_MS??'60000',MEDIA_ROOT:c.mediaRoot,EXPORT_ROOT:c.exportRoot})
   child('通知投递',['server/notification-worker.mjs'],{NOTIFICATION_DATABASE_URL:c.adminUrl,NOTIFICATION_ENCRYPTION_KEY:c.notificationKey,NOTIFICATION_DRIVER:process.env.NOTIFICATION_DRIVER??'local',NOTIFICATION_OUTBOX:process.env.NOTIFICATION_OUTBOX??join(dataRoot,'notification-outbox'),PUBLIC_ORIGIN:origin,MAIL_FROM:process.env.MAIL_FROM??'鹊信 <no-reply@quexin.local>',NOTIFICATION_INTERVAL_MS:process.env.NOTIFICATION_INTERVAL_MS??'5000'})
  }
  const deadline=Date.now()+20000
  while(!await ready(origin)||!await ready(`http://127.0.0.1:${c.apiPort}/health`)||!await ready(`http://127.0.0.1:${c.mockPort}/health`)){if(Date.now()>deadline)throw Error('服务启动超时，请查看 runtime/service.log');await pause(200)}
  await rm(socketPath,{force:true})
  server=httpServer((req,res)=>{
   if(req.method==='POST'&&req.headers['x-quexin-token']!==token){res.writeHead(403);res.end();return}
   res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({running:!stopping,url:origin,pid:process.pid,ports:[c.webPort,c.apiPort,c.mockPort],components:components.map(item=>({name:item.name,pid:item.pid,running:item.process.exitCode===null}))}))
   if(req.method==='POST')void shutdown(0,req.url==='/restart')
  });await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,resolve)});await chmod(socketPath,0o600)
  await privateJson(join(runtime,'state.json'),{pid:process.pid,token,startedAt:new Date().toISOString(),components:components.map(item=>({name:item.name,pid:item.pid}))})
  console.log(`鹊信已就绪：${origin}`)
 }catch(e){console.error(e.message);await shutdown(1)}
}
async function start(){
 const running=await status();if(running){console.log(`鹊信已经运行：${running.url}`);return}
 const c=await config();await freeServices(c)
 if(!await exists('node_modules/vite/bin/vite.js'))throw Error('依赖未安装，请先运行 npm ci。')
 const lock=join(runtime,'running.lock')
 if(await exists(lock)){
  const owner=await json(join(lock,'owner.json')).catch(()=>null);let alive=true
  if(Number.isInteger(owner?.pid)&&owner.pid>1){try{process.kill(owner.pid,0)}catch(error){if(error.code==='ESRCH')alive=false}}
  if(alive)throw Error('另一个启动进程仍在运行，或运行锁缺少归属信息。请先检查 runtime/service.log 和 local:status。')
  await rm(lock,{recursive:true,force:true});await rm(socketPath,{force:true});await rm(legacySocketPath,{force:true});await rm(join(runtime,'state.json'),{force:true})
 }
 const log=await open(join(runtime,'service.log'),'a',0o600)
 const daemon=spawn(process.execPath,[fileURLToPath(import.meta.url),'serve'],{cwd:project,detached:true,stdio:['ignore',log.fd,log.fd],env:process.env});daemon.unref();await log.close()
 const deadline=Date.now()+25000
 while(Date.now()<deadline){const result=await status();if(result){console.log(`鹊信已启动：${result.url}\n停止：npm run local:stop`);return}try{process.kill(daemon.pid,0)}catch{throw Error('启动失败，请查看 .local-data/runtime/service.log。')}await pause(200)}
 throw Error('等待启动超时，请运行 local:status 并检查 service.log。')
}
async function stop(){const current=await status();if(!current){console.log('没有由本启动器管理的运行实例；未结束其他进程。');return}const state=await json(join(runtime,'state.json'));await control('POST',state.token);const deadline=Date.now()+15000;while(Date.now()<deadline){if(!await exists(join(runtime,'running.lock'))){console.log('鹊信已停止，资料保留。');return}await pause(150)}throw Error('停止仍未完成，请检查 runtime/service.log。')}

function pgArgs(url){const u=new URL(url);return{args:['-h',u.hostname,'-p',u.port||'5432','-U',decodeURIComponent(u.username),'-d',decodeURIComponent(u.pathname.slice(1))],env:{PGPASSWORD:decodeURIComponent(u.password)}}}
async function files(dir,prefix=''){const all=[];for(const name of await readdir(dir)){const rel=prefix?prefix+'/'+name:name,path=join(dir,name),stat=await lstat(path);if(stat.isSymbolicLink())throw Error('备份不接受符号链接');if(stat.isDirectory())all.push(...await files(path,rel));else if(stat.isFile())all.push(rel)}return all}
async function copyTree(source,target){if(!await exists(source))return;await mkdir(target,{recursive:true,mode:0o700});for(const rel of await files(source)){const dest=join(target,rel);await mkdir(dirname(dest),{recursive:true,mode:0o700});await copyFile(join(source,rel),dest);await chmod(dest,0o600)}}
async function backup(){
 if(await status())throw Error('备份前先运行 npm run local:stop，确保数据库与照片副本一致。')
 const c=await config();await freeServices(c);const bin=c.pgBin??await binaries(),folder=join(dataRoot,'backups',new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomBytes(3).toString('hex'));await mkdir(folder,{recursive:true,mode:0o700})
 const started=await startDatabase(c)
 try{
  const p=pgArgs(c.adminUrl);await run(join(bin,'pg_dump'),[...p.args,'-Fc','--no-owner','--no-acl','--file',join(folder,'database.dump')],p.env);await chmod(join(folder,'database.dump'),0o600)
  await copyTree(c.mediaRoot,join(folder,'media'));await copyTree(c.exportRoot,join(folder,'exports'))
  if(await exists(c.mockData)){await copyFile(c.mockData,join(folder,'mock-cloud.json'));await chmod(join(folder,'mock-cloud.json'),0o600)}
  await privateJson(join(folder,'secrets.json'),{notificationKey:c.notificationKey,capsuleKey:c.capsuleKey??`${c.notificationKey}-capsule`})
  const hashes={};for(const rel of await files(folder))hashes[rel]=createHash('sha256').update(await readFile(join(folder,rel))).digest('hex')
  await privateJson(join(folder,'manifest.json'),{format:'quexin-local-server-v1',createdAt:new Date().toISOString(),hashes})
  console.log(`本机服务端备份：${folder}\n浏览器私人资料需另在“系统 → 数据与备份”导出 JSON。`)
 }finally{if(started)await stopDatabase(c)}
}
async function restore(folder){
 if(!folder)throw Error('用法：npm run local:restore -- 备份目录')
 if(await status())throw Error('恢复前先运行 npm run local:stop。')
 const c=await config();await freeServices(c);folder=resolve(folder);const manifest=await json(join(folder,'manifest.json'))
 if(manifest.format!=='quexin-local-server-v1'||!manifest.hashes?.['database.dump']||!manifest.hashes?.['secrets.json'])throw Error('不是完整的鹊信服务端备份')
 const names=(await files(folder)).filter(f=>f!=='manifest.json')
 if(names.length!==Object.keys(manifest.hashes).length)throw Error('备份文件数量不符')
 for(const rel of names)if(createHash('sha256').update(await readFile(join(folder,rel))).digest('hex')!==manifest.hashes[rel])throw Error(`备份校验失败：${rel}`)
 const secret=await json(join(folder,'secrets.json'));if(typeof secret.notificationKey!=='string'||!secret.notificationKey)throw Error('缺少通知解密密钥')
 const bin=c.pgBin??await binaries(),name='quexin_restore_'+Date.now(),started=await startDatabase(c),restoredRoot=join(dataRoot,name)
 try{
  await sql(c.adminUrl,`CREATE DATABASE ${name}`)
  const next={...c};for(const key of ['databaseUrl','adminUrl']){const u=new URL(c[key]);u.pathname='/'+name;next[key]=u.href}
  const p=pgArgs(next.adminUrl);await run(join(bin,'pg_restore'),[...p.args,'--exit-on-error','--no-owner','--no-acl',join(folder,'database.dump')],p.env)
  await migrate(next);await checkDatabase(next)
  await mkdir(restoredRoot,{recursive:true,mode:0o700});await copyTree(join(folder,'media'),join(restoredRoot,'media'));await copyTree(join(folder,'exports'),join(restoredRoot,'exports'))
  next.mediaRoot=join(restoredRoot,'media');next.exportRoot=join(restoredRoot,'exports');next.mockData=join(restoredRoot,'mock-cloud.json');next.notificationKey=secret.notificationKey;next.capsuleKey=secret.capsuleKey??`${secret.notificationKey}-capsule`
  if(await exists(join(folder,'mock-cloud.json'))){await copyFile(join(folder,'mock-cloud.json'),next.mockData);await chmod(next.mockData,0o600)}
  await privateJson(join(runtime,'config-before-restore-'+Date.now()+'.json'),c);await privateJson(configPath,next)
  console.log(`恢复成功，已切换到新数据库 ${name}。原数据库和原文件保留；运行 local:start 检查资料。`)
 }finally{if(started)await stopDatabase(c)}
}

try{
 const [major,minor]=process.versions.node.split('.').map(Number)
 if(major<22||(major===22&&minor<12))throw Error('需要 Node.js 22.12 或更新版本。')
 if(action==='init')await initialize()
 else if(action==='serve')await serve()
 else if(action==='start')await start()
 else if(action==='stop')await stop()
 else if(action==='status'){const s=await status();console.log(s?`运行中：${s.url}`:'启动器未运行。');if(s?.components)for(const item of s.components)console.log(`${item.running?'✓':'×'} ${item.name} · PID ${item.pid}`);const c=await config();for(const p of [c.webPort,c.apiPort,c.mockPort])console.log(`${p}：${await free(p)?'空闲':'已占用'}`)}
 else if(action==='migrate'){const c=await config(),started=await startDatabase(c);try{await migrate(c);await checkDatabase(c);console.log('迁移检查完成。')}finally{if(started)await stopDatabase(c)}}
 else if(action==='backup')await backup()
 else if(action==='cleanup'){
  const c=await config(),started=await startDatabase(c),pool=new pg.Pool({connectionString:c.adminUrl,max:1})
  try{const {retryFileCleanup}=await import('../server/lib/file-cleanup.mjs'),{LocalMediaStore}=await import('../server/lib/local-media-store.mjs'),{LocalExportStore}=await import('../server/lib/local-export-store.mjs');const result=await retryFileCleanup({pool,mediaStore:new LocalMediaStore(c.mediaRoot),exportStore:new LocalExportStore(c.exportRoot)});console.log(`已清理 ${result.completed} 项，${result.failed} 项等待重试`)}finally{await pool.end();if(started)await stopDatabase(c)}
 }
 else if(action==='restore')await restore(argument)
 else throw Error('支持 init/start/stop/status/migrate/backup/restore/cleanup')
}catch(error){console.error('鹊信：'+error.message);process.exitCode=1}
