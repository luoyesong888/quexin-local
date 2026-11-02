import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,readFile,writeFile,readdir,mkdir,rm,cp,stat} from 'node:fs/promises'
import {join} from 'node:path'
import {createServer} from 'node:net'
import pg from 'pg'
const exec=promisify(execFile),root=await mkdtemp('/private/tmp/quexin-runtime-'),script='scripts/local-runtime.mjs'
const env={...process.env,QUEXIN_LOCAL_DATA:root,OPTIONAL_CONFIG_PATH:join(root,'.env.local'),WEB_PORT:'5188',LOCAL_API_PORT:'5193',LOCAL_MOCK_PORT:'5191',LOCAL_PG_PORT:'5545',MAINTENANCE_INTERVAL_MS:'10000',NOTIFICATION_INTERVAL_MS:'5000'}
const run=async(...args)=>(await exec(process.execPath,[script,...args],{env,maxBuffer:2*1024*1024})).stdout
const config=async()=>JSON.parse(await readFile(join(root,'runtime/config.json'),'utf8'))
async function query(url,text,args=[]){const c=new pg.Client({connectionString:url});try{await c.connect();return await c.query(text,args)}finally{await c.end()}}
async function waitFor(check,timeout=12_000){const deadline=Date.now()+timeout;while(Date.now()<deadline){if(await check())return;await new Promise(resolve=>setTimeout(resolve,200))}throw new Error('等待后台组件状态超时')}
let blocker
try{
 await run('init');const c=await config();assert.equal((await stat(join(root,'runtime/config.json'))).mode&0o777,0o600)
 assert.match(await run('start'),/已启动/);assert.match(await run('start'),/已经运行/);const running=await run('status');for(const name of ['模拟 API','本机账号 API','网页','后台维护','通知投递'])assert.match(running,new RegExp(`✓ ${name}`))
 const health=await fetch('http://127.0.0.1:5188/formal/health').then(r=>r.json());assert.equal(health.data.database,'postgres');assert.equal(health.data.status,'ready')
 await waitFor(async()=>Number((await query(c.adminUrl,'SELECT count(*) FROM quexin.maintenance_runs')).rows[0].count)>0)
 const registerResponse=await fetch('http://127.0.0.1:5193/v1/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'recovery@example.test',displayName:'备份时的名字',password:'runtime-recovery-password'})}),cookie=registerResponse.headers.get('set-cookie').split(';')[0],register=await registerResponse.json();assert.equal(register.ok,true)
 await waitFor(async()=>Number((await query(c.adminUrl,"SELECT count(*) FROM quexin.notification_jobs WHERE recipient='recovery@example.test' AND status='sent'")).rows[0].count)>0)
 assert.ok((await readdir(join(root,'notification-outbox'))).some(name=>name.endsWith('.json')))
 const secret='runtime-deepseek-secret-key',configuredResponse=await fetch('http://127.0.0.1:5193/v1/admin/assistant-config',{method:'PUT',headers:{'content-type':'application/json',cookie},body:JSON.stringify({enabled:true,provider:'deepseek',apiUrl:'https://api.deepseek.com',apiKey:secret,model:'deepseek-flash',transcriptionModel:'',currentPassword:'runtime-recovery-password'})}),configured=await configuredResponse.json();assert.equal(configuredResponse.status,200);assert.equal(configured.data.restarting,true);assert.equal(JSON.stringify(configured).includes(secret),false)
 await waitFor(async()=>fetch('http://127.0.0.1:5193/health').then(response=>response.json()).then(value=>value.data?.capabilities?.assistant===true).catch(()=>false),30_000)
 await waitFor(async()=>/运行中/.test(await run('status').catch(()=>'')),30_000)
 const adminStatus=await fetch('http://127.0.0.1:5193/v1/admin/assistant-config',{headers:{cookie}}).then(response=>response.json());assert.equal(adminStatus.data.provider,'deepseek');assert.equal(adminStatus.data.hasApiKey,true);assert.equal(JSON.stringify(adminStatus).includes(secret),false);assert.equal((await stat(join(root,'.env.local'))).mode&0o777,0o600)
 await mkdir(c.mediaRoot,{recursive:true});await writeFile(join(c.mediaRoot,'recovery-test.txt'),'备份时的照片副本')
 for(const path of [join(root,'runtime'),c.mediaRoot,c.exportRoot,join(root,'notification-outbox')])assert.equal((await stat(path)).mode&0o777,0o700)
 await assert.rejects(()=>run('backup'),/备份前先运行/)
 await run('stop');assert.match(await run('status'),/启动器未运行/)
 await mkdir(join(root,'runtime/running.lock'));await writeFile(join(root,'runtime/running.lock/owner.json'),JSON.stringify({pid:99999999}))
 blocker=createServer();await new Promise((resolve,reject)=>{blocker.once('error',reject);blocker.listen(5188,'127.0.0.1',resolve)})
 await assert.rejects(()=>run('start'),/端口 5188 已被占用/);assert.equal(blocker.listening,true);await new Promise(r=>blocker.close(r));blocker=null
 await run('start')
 const login=await fetch('http://127.0.0.1:5193/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'recovery@example.test',password:'runtime-recovery-password'})}).then(r=>r.json());assert.equal(login.ok,true)
 await run('stop');await run('backup');const folder=join(root,'backups',(await readdir(join(root,'backups')))[0])
 assert.equal((await stat(join(folder,'database.dump'))).mode&0o777,0o600)
 await run('start');await query(c.adminUrl,"UPDATE quexin.app_users SET display_name='备份后的修改' WHERE email='recovery@example.test'");await writeFile(join(c.mediaRoot,'recovery-test.txt'),'备份之后');await run('stop')
 const corrupt=join(root,'corrupt');await cp(folder,corrupt,{recursive:true});await writeFile(join(corrupt,'database.dump'),'损坏的备份')
 await assert.rejects(()=>run('restore',corrupt),/备份校验失败/);assert.equal((await config()).databaseUrl,c.databaseUrl)
 await run('restore',folder);const next=await config();assert.notEqual(next.databaseUrl,c.databaseUrl);assert.equal(next.notificationKey,c.notificationKey)
 await run('start');assert.equal((await query(next.adminUrl,"SELECT display_name FROM quexin.app_users WHERE email='recovery@example.test'")).rows[0].display_name,'备份时的名字')
 assert.equal((await query(c.adminUrl,"SELECT display_name FROM quexin.app_users WHERE email='recovery@example.test'")).rows[0].display_name,'备份后的修改')
 assert.equal(await readFile(join(next.mediaRoot,'recovery-test.txt'),'utf8'),'备份时的照片副本')
 await run('stop');await run('stop')
 console.log('本地运行器通过：五组件托管/状态、数据库就绪、页面 API 配置与安全重启、维护与通知后台任务、目录权限、启停/旧锁/端口保护、备份损坏拒绝、新库恢复、媒体/密钥恢复和原库保留。')
}finally{
 if(blocker)await new Promise(r=>blocker.close(r))
 await run('stop').catch(()=>{})
 const c=await config().catch(()=>null);if(c?.pgData)await exec(join(c.pgBin,'pg_ctl'),['-D',c.pgData,'-m','fast','-w','stop']).catch(()=>{})
 await rm(root,{recursive:true,force:true})
}
