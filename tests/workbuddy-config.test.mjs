import test from 'node:test'
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {access,chmod,cp,lstat,mkdtemp,mkdir,readFile,readdir,rm,symlink,writeFile} from 'node:fs/promises'
import {join} from 'node:path'

const exec=promisify(execFile),exists=path=>access(path).then(()=>true).catch(()=>false)
test('WorkBuddy 可选配置支持计划、脱敏应用、运行中重启、备份和关闭回本地模式',async()=>{
  const source=process.cwd(),root=await mkdtemp('/private/tmp/quexin optional config-'),data=join(root,'.local-data'),env={...process.env,QUEXIN_LOCAL_DATA:data,WEB_PORT:'6581',LOCAL_API_PORT:'6582',LOCAL_MOCK_PORT:'6583',LOCAL_PG_PORT:'5568'},run=(script,args=[])=>exec(process.execPath,[script,...args],{cwd:root,env,maxBuffer:10*1024*1024});let config
  try{
    for(const dir of ['src','shared','public','server','scripts','release','config'])await cp(join(source,dir),join(root,dir),{recursive:true})
    for(const file of ['package.json','package-lock.json','index.html','vite.config.ts','tsconfig.json','tsconfig.app.json','tsconfig.node.json','README.md','本地使用说明.md','DEPLOY_WITH_WORKBUDDY.md','WorkBuddy部署检查.command'])await cp(join(source,file),join(root,file))
    await symlink(join(source,'node_modules'),join(root,'node_modules'));await run('scripts/workbuddy-deploy.mjs',['install','--yes']);config=JSON.parse(await readFile(join(data,'runtime/config.json'),'utf8'))
    const secret='integration-secret-model-key',enabled=join(root,'.workbuddy-options.local.json');await writeFile(enabled,JSON.stringify({model:{enabled:true,apiUrl:'https://models.example.test/v1',apiKey:secret,model:'integration-model',transcriptionModel:'integration-transcribe'},mail:{mode:'local'}},null,2),{mode:0o600})
    const plan=await run('scripts/workbuddy-config.mjs',['plan','--input',enabled]);assert.equal(plan.stdout.includes(secret),false);assert.equal(await exists(join(root,'.env.local')),false)
    const applied=await run('scripts/workbuddy-config.mjs',['apply','--input',enabled,'--yes']);assert.equal(applied.stdout.includes(secret),false);assert.equal((await lstat(join(root,'.env.local'))).mode&0o777,0o600)
    const health=await fetch('http://127.0.0.1:6582/health').then(response=>response.json());assert.deepEqual(health.data.capabilities,{assistant:true,ocr:true,transcription:true})
    const status=await run('scripts/workbuddy-config.mjs',['status','--json']),publicStatus=JSON.parse(status.stdout);assert.equal(publicStatus.model.model,'integration-model');assert.equal(status.stdout.includes(secret),false)
    const before=await readFile(join(root,'.env.local'),'utf8'),smtp=join(root,'smtp-failure.json');await writeFile(smtp,JSON.stringify({model:{enabled:true,apiUrl:'https://models.example.test/v1',apiKey:secret,model:'integration-model',transcriptionModel:'integration-transcribe'},mail:{mode:'smtp',smtpUrl:'smtps://user:mail-secret@127.0.0.1:1',from:'鹊信 <mail@example.test>'}}),{mode:0o600});await assert.rejects(()=>run('scripts/workbuddy-config.mjs',['apply','--input',smtp,'--yes']),error=>{assert.match(String(error.stderr),/已恢复旧配置/);assert.equal(String(error.stderr).includes('mail-secret'),false);return true});assert.equal(await readFile(join(root,'.env.local'),'utf8'),before);assert.equal((await fetch('http://127.0.0.1:6582/health')).ok,true)
    const invalid=join(root,'invalid.json');await writeFile(invalid,JSON.stringify({model:{enabled:true,apiUrl:'http://remote.example.test/v1',apiKey:'another-valid-secret',model:'bad'},mail:{mode:'local'}}),{mode:0o600});await assert.rejects(()=>run('scripts/workbuddy-config.mjs',['apply','--input',invalid,'--yes']));assert.equal(await readFile(join(root,'.env.local'),'utf8'),before)
    const localOnly=join(root,'local-only.json');await writeFile(localOnly,JSON.stringify({model:{enabled:false},mail:{mode:'local'}}),{mode:0o600});await run('scripts/workbuddy-config.mjs',['apply','--input',localOnly,'--yes']);assert.deepEqual((await fetch('http://127.0.0.1:6582/health').then(response=>response.json())).data.capabilities,{assistant:false,ocr:false,transcription:false})
    const backups=await readdir(join(data,'runtime/optional-config-backups'));assert.equal(backups.length,2);for(const backup of backups)assert.equal((await lstat(join(data,'runtime/optional-config-backups',backup))).mode&0o777,0o600)
    await run('scripts/workbuddy-deploy.mjs',['stop'])
  }finally{
    await run('scripts/workbuddy-deploy.mjs',['stop']).catch(()=>{});if(config?.pgData)await exec(join(config.pgBin,'pg_ctl'),['-D',config.pgData,'-m','fast','-w','stop']).catch(()=>{});await rm(root,{recursive:true,force:true})
  }
})
