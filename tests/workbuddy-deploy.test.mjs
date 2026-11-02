import test from 'node:test'
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {access,cp,mkdtemp,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises'
import {join} from 'node:path'

const exec=promisify(execFile),script='scripts/workbuddy-deploy.mjs',exists=path=>access(path).then(()=>true).catch(()=>false)
const invoke=async(env,...args)=>exec(process.execPath,[script,...args],{cwd:process.cwd(),env,maxBuffer:8*1024*1024})

test('WorkBuddy 安装幂等、保留账号并支持状态/诊断/备份/验证/停止',async()=>{
  const base=await mkdtemp('/private/tmp/quexin-workbuddy-'),data=join(base,'data'),env={...process.env,QUEXIN_LOCAL_DATA:data,WEB_PORT:'6288',LOCAL_API_PORT:'6293',LOCAL_MOCK_PORT:'6291',LOCAL_PG_PORT:'5565',MAINTENANCE_INTERVAL_MS:'10000',NOTIFICATION_INTERVAL_MS:'5000'}
  let config
  try{
    await assert.rejects(()=>invoke(env,'install'),error=>{assert.equal(error.code,2);assert.match(error.stdout,/install --yes/);return true});assert.equal(await exists(join(data,'runtime/config.json')),false)
    const first=await invoke(env,'install','--yes');assert.match(first.stdout,/部署完成/);config=JSON.parse(await readFile(join(data,'runtime/config.json'),'utf8'));assert.equal((await fetch('http://127.0.0.1:6293/health').then(response=>response.json())).data.status,'ready')
    const registration=await fetch('http://127.0.0.1:6293/v1/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'workbuddy-install@example.test',displayName:'安装保留测试',password:'workbuddy-install-password'})}).then(response=>response.json());assert.equal(registration.ok,true)
    const second=await invoke(env,'install','--yes');assert.match(second.stdout,/现有资料/);assert.match(second.stdout,/不会重置资料/)
    const login=await fetch('http://127.0.0.1:6293/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'workbuddy-install@example.test',password:'workbuddy-install-password'})}).then(response=>response.json());assert.equal(login.ok,true)
    const status=await invoke(env,'status');for(const name of ['模拟 API','本机账号 API','网页','后台维护','通知投递'])assert.match(status.stdout,new RegExp(name))
    const doctor=await invoke(env,'doctor');assert.match(doctor.stdout,/结果：通过/)
    await assert.rejects(()=>invoke(env,'backup'),error=>{assert.equal(error.code,2);assert.match(error.stdout,/backup --yes/);return true});assert.equal(await exists(join(data,'backups')),false)
    const backup=await invoke(env,'backup','--yes');assert.match(backup.stdout,/备份完成/);assert.ok((await readdir(join(data,'backups'))).length===1);assert.equal((await fetch('http://127.0.0.1:6293/health')).ok,true)
    const verify=await invoke(env,'verify');assert.match(verify.stdout,/健康检查通过/)
    const installRecord=JSON.parse(await readFile(join(data,'runtime/workbuddy-install.json'),'utf8'));assert.equal(installRecord.existingDataPreserved,true);assert.match(installRecord.lockSha256,/^[a-f0-9]{64}$/)
    await invoke(env,'stop');assert.equal(await fetch('http://127.0.0.1:6293/health').then(()=>true).catch(()=>false),false);await invoke(env,'stop')
  }finally{
    await invoke(env,'stop').catch(()=>{})
    if(config?.pgData)await exec(join(config.pgBin,'pg_ctl'),['-D',config.pgData,'-m','fast','-w','stop']).catch(()=>{})
    await rm(base,{recursive:true,force:true})
  }
})

test('并发部署锁会阻止第二个变更操作',async()=>{
  const base=await mkdtemp('/private/tmp/quexin-workbuddy-lock-'),data=join(base,'data'),env={...process.env,QUEXIN_LOCAL_DATA:data,WEB_PORT:'6381',LOCAL_API_PORT:'6382',LOCAL_MOCK_PORT:'6383',LOCAL_PG_PORT:'5566'}
  try{const lock=join(data,'runtime/workbuddy-deploy.lock');await mkdir(lock,{recursive:true});await writeFile(join(lock,'owner.json'),JSON.stringify({pid:process.pid}));await assert.rejects(()=>invoke(env,'install','--yes'),error=>{assert.match(String(error.stderr),/另一个 WorkBuddy 部署操作仍在运行/);return true});assert.equal(await exists(join(data,'runtime/config.json')),false)}finally{await rm(base,{recursive:true,force:true})}
})

test('无 node_modules 的全新副本会按 lockfile 离线安装依赖后完成部署',async()=>{
  const root=await mkdtemp('/private/tmp/quexin workbuddy offline-'),source=process.cwd(),data=join(root,'.local-data'),env={...process.env,QUEXIN_LOCAL_DATA:data,WEB_PORT:'6481',LOCAL_API_PORT:'6482',LOCAL_MOCK_PORT:'6483',LOCAL_PG_PORT:'5567',npm_config_offline:'true'}
  let config
  try{
    for(const dir of ['src','shared','public','server','scripts','release'])await cp(join(source,dir),join(root,dir),{recursive:true})
    for(const file of ['package.json','package-lock.json','index.html','vite.config.ts','tsconfig.json','tsconfig.app.json','tsconfig.node.json','README.md','本地使用说明.md','DEPLOY_WITH_WORKBUDDY.md','WorkBuddy部署检查.command'])await cp(join(source,file),join(root,file))
    const result=await exec(process.execPath,['scripts/workbuddy-deploy.mjs','install','--yes'],{cwd:root,env,maxBuffer:12*1024*1024});assert.match(result.stdout,/安装 package-lock.json 锁定的依赖/);assert.match(result.stdout,/部署完成/);assert.equal(await exists(join(root,'node_modules/.package-lock.json')),true)
    config=JSON.parse(await readFile(join(data,'runtime/config.json'),'utf8'));assert.equal((await fetch('http://127.0.0.1:6482/health')).ok,true)
    await exec(process.execPath,['scripts/workbuddy-deploy.mjs','stop'],{cwd:root,env})
  }finally{
    await exec(process.execPath,['scripts/workbuddy-deploy.mjs','stop'],{cwd:root,env}).catch(()=>{})
    if(config?.pgData)await exec(join(config.pgBin,'pg_ctl'),['-D',config.pgData,'-m','fast','-w','stop']).catch(()=>{})
    await rm(root,{recursive:true,force:true})
  }
})
