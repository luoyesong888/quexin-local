import {spawn,execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
const exec=promisify(execFile),results=[],root='test-results/full'
await mkdir(root,{recursive:true})
async function check(name,command,args,env={}){
 console.log(`\n正在验收：${name}`);const started=Date.now();let output=''
 const code=await new Promise(resolve=>{const p=spawn(command,args,{env:{...process.env,...env},stdio:['ignore','pipe','pipe']});for(const stream of [p.stdout,p.stderr])stream.on('data',chunk=>{output+=chunk;process.stdout.write(chunk)});p.once('error',error=>{output+=error.message;resolve(1)});p.once('exit',code=>resolve(code??1))})
 await writeFile(join(root,name+'.log'),output);results.push({name,passed:code===0,seconds:Math.round((Date.now()-started)/1000)})
 if(code!==0)throw Error(`${name} 未通过，见 ${root}/${name}.log`)
}
let isolated,configuration,isolatedEnv
try{
 if(process.argv.includes('--postgres')){
  isolated=await mkdtemp('/private/tmp/quexin-full-');isolatedEnv={QUEXIN_LOCAL_DATA:isolated,WEB_PORT:'5288',LOCAL_API_PORT:'5293',LOCAL_MOCK_PORT:'5291',LOCAL_PG_PORT:'5546',DISABLE_BACKGROUND_WORKERS:'true'}
  await check('postgres-init',process.execPath,['scripts/local-runtime.mjs','init'],isolatedEnv)
  await check('postgres-start',process.execPath,['scripts/local-runtime.mjs','start'],isolatedEnv)
  configuration=JSON.parse(await readFile(join(isolated,'runtime/config.json'),'utf8'))
  await check('maintenance',process.execPath,['scripts/test-maintenance.mjs'],{MAINTENANCE_DATABASE_URL:configuration.adminUrl})
  await check('notification-json',process.execPath,['scripts/test-notification.mjs'],{NOTIFICATION_DATABASE_URL:configuration.adminUrl})
  await check('operations-permissions',process.execPath,['scripts/test-operations-permissions.mjs'],{OPERATIONS_APP_URL:configuration.databaseUrl,OPERATIONS_ADMIN_URL:configuration.adminUrl})
  await check('local-runtime','npm',['run','test:local-runtime'])
  await check('postgres-api','npm',['run','test:api:postgres'],{API_TEST_DATABASE_URL:configuration.databaseUrl})
  await check('postgres-lifecycle','npm',['run','test:lifecycle'],{LIFECYCLE_HTTP_DATABASE_URL:configuration.databaseUrl})
  await check('postgres-care','npm',['run','test:care'],{CARE_HTTP_DATABASE_URL:configuration.databaseUrl})
  await check('postgres-creation','npm',['run','test:creation'],{CREATION_HTTP_DATABASE_URL:configuration.databaseUrl})
 }
 await check('account-tokens',process.execPath,['--test','tests/account-tokens.test.mjs'],configuration?{ACCOUNT_TEST_DATABASE_URL:configuration.adminUrl}:{})
 await check('runtime-config',process.execPath,['--test','tests/runtime-config.test.mjs'])
 await check('workbuddy-preflight',process.execPath,['--test','tests/workbuddy-preflight.test.mjs'])
 await check('workbuddy-deploy',process.execPath,['--test','tests/workbuddy-deploy.test.mjs'])
 await check('release-bundle',process.execPath,['--test','tests/release-bundle.test.mjs'])
 await check('workbuddy-options',process.execPath,['--test','tests/workbuddy-options.test.mjs'])
 await check('assistant-admin-config',process.execPath,['--test','tests/assistant-admin-config.test.mjs'])
 await check('qingniao-skill',process.execPath,['--test','tests/qingniao-skill-package.test.mjs'])
 await check('workbuddy-config',process.execPath,['--test','tests/workbuddy-config.test.mjs'])
 await check('workbuddy-lifecycle',process.execPath,['--test','tests/workbuddy-lifecycle.test.mjs'])
 await check('workbuddy-chat-contract',process.execPath,['--test','tests/workbuddy-chat-contract.test.mjs'])
 await check('workbuddy-inbox',process.execPath,['--test','tests/workbuddy-inbox.test.mjs'])
 await check('companion-store',process.execPath,['--test','tests/companion-store.test.mjs'],configuration?{ACCOUNT_TEST_DATABASE_URL:configuration.adminUrl}:{})
 await check('capsule-store',process.execPath,['--test','tests/capsule-store.test.mjs'],configuration?{CAPSULE_TEST_DATABASE_URL:configuration.databaseUrl}:{})
 await check('lifecycle-store',process.execPath,['--test','tests/lifecycle-store.test.mjs'],configuration?{LIFECYCLE_TEST_DATABASE_URL:configuration.databaseUrl,LIFECYCLE_ADMIN_URL:configuration.adminUrl}:{})
 for(const name of ['api','account','couple','e2e','import','privacy','lifecycle','ai','care','creation','a11y','compat','performance','visual','release'])await check(name,'npm',['run','test:'+name])
 await check('reminders',process.execPath,['--test','tests/reminders.test.mjs'])
 await check('care-store',process.execPath,['--test','tests/care-store.test.mjs'],configuration?{CARE_TEST_DATABASE_URL:configuration.databaseUrl}:{})
 await check('build','npm',['run','build'])
 await check('pwa','npx',['playwright','test','--config','playwright.pwa.config.ts'])
 console.log('\n本轮完整回归通过。')
}catch(error){console.error(error.message);process.exitCode=1}
finally{
 if(isolated){await exec(process.execPath,['scripts/local-runtime.mjs','stop'],{env:{...process.env,...isolatedEnv}}).catch(()=>{});if(configuration?.pgData)await exec(join(configuration.pgBin,'pg_ctl'),['-D',configuration.pgData,'-m','fast','-w','stop']).catch(()=>{});await rm(isolated,{recursive:true,force:true})}
 await writeFile(join(root,'summary.json'),JSON.stringify({date:new Date().toISOString(),results},null,2)+'\n')
}
