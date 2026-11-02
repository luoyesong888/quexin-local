import test from 'node:test'
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {createHash} from 'node:crypto'
import {access,appendFile,cp,mkdtemp,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises'
import {dirname,join} from 'node:path'

const exec=promisify(execFile),source=process.cwd(),exists=path=>access(path).then(()=>true).catch(()=>false)
async function makePackage(parent,version,{badMigration=false,marker=''}={}){
  const root=join(parent,`source-${version}`),spec=JSON.parse(await readFile(join(source,'release/local-release-spec.json'),'utf8'));await mkdir(root,{recursive:true})
  for(const directory of spec.includeDirectories)await cp(join(source,directory),join(root,directory),{recursive:true})
  for(const file of spec.includeFiles){await mkdir(dirname(join(root,file)),{recursive:true});await cp(join(source,file),join(root,file))}
  const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8')),lock=JSON.parse(await readFile(join(root,'package-lock.json'),'utf8'));pkg.version=version;lock.version=version;if(lock.packages?.[''])lock.packages[''].version=version;await writeFile(join(root,'package.json'),JSON.stringify(pkg,null,2)+'\n');await writeFile(join(root,'package-lock.json'),JSON.stringify(lock,null,2)+'\n');if(marker)await appendFile(join(root,'README.md'),`\n${marker}\n`);if(badMigration)await writeFile(join(root,'server/migrations/999_intentional_failure.sql'),'THIS IS NOT VALID SQL;\n')
  const output=join(parent,`artifacts-${version}`),built=await exec(process.execPath,['scripts/release-bundle.mjs','--output',output],{cwd:root,maxBuffer:12*1024*1024});return JSON.parse(built.stdout)
}
const digest=buffer=>createHash('sha256').update(buffer).digest('hex')

test('升级失败自动恢复、有效升级、程序回滚、保留数据卸载和确认后移入数据废纸篓',async()=>{
  const base=await mkdtemp('/private/tmp/quexin lifecycle-'),packages=join(base,'packages'),installParent=join(base,'installed'),trash=join(base,'trash');await mkdir(packages);await mkdir(installParent);await mkdir(trash)
  const basePackage=await makePackage(packages,'0.1.0'),badPackage=await makePackage(packages,'0.1.1',{badMigration:true}),nextPackage=await makePackage(packages,'0.1.2',{marker:'WORKBUDDY_UPGRADE_MARKER_012'});await exec('tar',['-xzf',basePackage.archive,'-C',installParent]);const project=join(installParent,'quexin-local'),data=join(project,'.local-data'),env={...process.env,QUEXIN_LOCAL_DATA:data,QUEXIN_TRASH_ROOT:trash,WEB_PORT:'6681',LOCAL_API_PORT:'6682',LOCAL_MOCK_PORT:'6683',LOCAL_PG_PORT:'5569',npm_config_offline:'true'},run=(script,args=[])=>exec(process.execPath,[script,...args],{cwd:project,env,maxBuffer:20*1024*1024});let config
  try{
    await run('scripts/workbuddy-deploy.mjs',['install','--yes']);config=JSON.parse(await readFile(join(data,'runtime/config.json'),'utf8'))
    const register=await fetch('http://127.0.0.1:6682/v1/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'lifecycle@example.test',displayName:'升级保留用户',password:'lifecycle-test-password'})}).then(response=>response.json());assert.equal(register.ok,true)

    const tampered=join(packages,'tampered.tar.gz'),original=await readFile(badPackage.archive);await writeFile(tampered,Buffer.concat([original,Buffer.from('tampered')]));await cp(badPackage.manifest,tampered.replace(/\.tar\.gz$/,'.manifest.json'));await writeFile(tampered+'.sha256',`${digest(original)}  ${tampered.split('/').at(-1)}\n`);await assert.rejects(()=>run('scripts/workbuddy-lifecycle.mjs',['upgrade','--package',tampered,'--yes']),error=>{assert.match(error.stderr,/SHA-256 不匹配/);return true});assert.equal(JSON.parse(await readFile(join(project,'package.json'),'utf8')).version,'0.1.0');assert.equal((await fetch('http://127.0.0.1:6682/health')).ok,true)

    await assert.rejects(()=>run('scripts/workbuddy-lifecycle.mjs',['upgrade','--package',badPackage.archive,'--yes']),error=>{assert.match(error.stderr,/已恢复旧程序和升级前数据库/);return true});assert.equal(JSON.parse(await readFile(join(project,'package.json'),'utf8')).version,'0.1.0');const loginAfterFailure=await fetch('http://127.0.0.1:6682/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'lifecycle@example.test',password:'lifecycle-test-password'})}).then(response=>response.json());assert.equal(loginAfterFailure.ok,true)

    const upgraded=await run('scripts/workbuddy-lifecycle.mjs',['upgrade','--package',nextPackage.archive,'--yes']);assert.match(upgraded.stdout,/升级完成/);assert.equal(JSON.parse(await readFile(join(project,'package.json'),'utf8')).version,'0.1.2');assert.match(await readFile(join(project,'README.md'),'utf8'),/WORKBUDDY_UPGRADE_MARKER_012/);assert.equal((await fetch('http://127.0.0.1:6682/health')).ok,true)
    const rolled=await run('scripts/workbuddy-lifecycle.mjs',['rollback','--yes']);assert.match(rolled.stdout,/回滚到 v0.1.0/);assert.equal(JSON.parse(await readFile(join(project,'package.json'),'utf8')).version,'0.1.0');assert.equal((await readFile(join(project,'README.md'),'utf8')).includes('WORKBUDDY_UPGRADE_MARKER_012'),false);const loginAfterRollback=await fetch('http://127.0.0.1:6682/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'lifecycle@example.test',password:'lifecycle-test-password'})}).then(response=>response.json());assert.equal(loginAfterRollback.ok,true)

    const removed=await run('scripts/workbuddy-lifecycle.mjs',['uninstall','--yes']);assert.match(removed.stdout,/用户数据保留/);assert.equal(await exists(join(project,'package.json')),false);assert.equal(await exists(join(data,'runtime/config.json')),true);assert.equal(await exists(join(project,'鹊信数据保留说明.txt')),true);const programTrash=(await readdir(trash)).find(name=>name.startsWith('鹊信-program-'));assert.ok(programTrash)
    const trashProgram=join(trash,programTrash),purged=await exec(process.execPath,[join(trashProgram,'scripts/workbuddy-lifecycle.mjs'),'purge-data','--yes','--confirmation','永久删除鹊信本地资料'],{cwd:trashProgram,env,maxBuffer:20*1024*1024});assert.match(purged.stdout,/本地数据已移入可恢复废纸篓/);assert.equal(await exists(data),false);assert.ok((await readdir(trash)).some(name=>name.startsWith('鹊信-data-')))
  }finally{
    await run('scripts/workbuddy-deploy.mjs',['stop']).catch(()=>{});if(config?.pgData)await exec(join(config.pgBin,'pg_ctl'),['-D',config.pgData,'-m','fast','-w','stop']).catch(()=>{});await rm(base,{recursive:true,force:true})
  }
})
