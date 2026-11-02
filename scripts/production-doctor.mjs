import {readFile,stat,statfs} from 'node:fs/promises'
import {resolve} from 'node:path'
import pg from 'pg'
import {validateRuntimeConfig,redactConnection} from '../server/lib/runtime-config.mjs'

try{process.loadEnvFile(resolve('.env.local'))}catch(error){if(error?.code!=='ENOENT')throw error}
const local=process.argv.includes('--local'),external=process.argv.includes('--external'),json=process.argv.includes('--json'),checks=[]
let environment={...process.env},localConfig
if(local){
  localConfig=JSON.parse(await readFile(resolve(process.env.QUEXIN_LOCAL_DATA??'.local-data','runtime/config.json'),'utf8'))
  environment={...environment,DATABASE_URL:localConfig.databaseUrl,MAINTENANCE_DATABASE_URL:localConfig.adminUrl,NOTIFICATION_DATABASE_URL:localConfig.adminUrl,NOTIFICATION_ENCRYPTION_KEY:localConfig.notificationKey,CAPSULE_ENCRYPTION_KEY:localConfig.capsuleKey,PUBLIC_ORIGIN:`http://127.0.0.1:${localConfig.webPort}`,NOTIFICATION_DRIVER:'local',DEV_MAILBOX:'true'}
}
const validated=validateRuntimeConfig(environment,{local});checks.push(...validated.checks)
const secrets=[environment.NOTIFICATION_ENCRYPTION_KEY,environment.CAPSULE_ENCRYPTION_KEY,environment.ASSISTANT_API_KEY].filter(Boolean),safe=input=>{let output=String(input).replace(/(postgres(?:ql)?|smtps?):\/\/[^\s]+/gi,'$1://[已隐藏]');for(const secret of secrets)output=output.replaceAll(String(secret),'[已隐藏]');return output},add=(id,status,message)=>checks.push({id,status,message:safe(message)})
async function databaseChecks(){
  if(!environment.DATABASE_URL)return
  const app=new pg.Client({connectionString:environment.DATABASE_URL,connectionTimeoutMillis:5000})
  try{
    await app.connect();const role=(await app.query(`SELECT current_user,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`)).rows[0]
    add('database-connect','pass',`应用数据库可连接：${redactConnection(environment.DATABASE_URL)}`)
    add('database-role',!role.rolsuper&&!role.rolbypassrls?'pass':'error',!role.rolsuper&&!role.rolbypassrls?'应用角色未拥有超级用户/BYPASSRLS':'应用角色权限过高')
    const migrations=(await app.query('SELECT count(*)::integer AS count,max(name) AS latest FROM quexin.schema_migrations')).rows[0],files=(await import('node:fs/promises')).readdir('server/migrations').then(items=>items.filter(item=>item.endsWith('.sql')).length)
    add('database-migrations',migrations.count===await files?'pass':'error',`迁移 ${migrations.count}/${await files} · 最新 ${migrations.latest??'无'}`)
  }catch(error){add('database-connect','error',`应用数据库检查失败：${error instanceof Error?error.message:'未知错误'}`)}finally{await app.end().catch(()=>{})}
}
await databaseChecks()
if(localConfig){
  for(const path of [resolve(process.env.QUEXIN_LOCAL_DATA??'.local-data','runtime'),localConfig.mediaRoot,localConfig.exportRoot])try{const mode=(await stat(path)).mode&0o777;add(`permissions:${path.split('/').pop()}`,mode&0o077?'warning':'pass',`${path.split('/').pop()} 权限 ${mode.toString(8)}`)}catch{add(`permissions:${path.split('/').pop()}`,'warning',`${path.split('/').pop()} 尚未创建`)}
  try{const disk=await statfs(resolve(process.env.QUEXIN_LOCAL_DATA??'.local-data')),free=disk.bavail*disk.bsize;add('disk-space',free>512*1024*1024?'pass':'error',`可用磁盘 ${(free/1024/1024/1024).toFixed(1)} GiB`)}catch{add('disk-space','warning','无法读取可用磁盘')}
}
if(external&&environment.NOTIFICATION_DRIVER==='smtp'&&!checks.some(item=>item.status==='error'))try{const nodemailer=(await import('nodemailer')).default,transport=nodemailer.createTransport(environment.SMTP_URL,{pool:true});await transport.verify();transport.close();add('smtp-external','pass','SMTP 连接与认证验证通过（未发送邮件）')}catch(error){add('smtp-external','error',`SMTP 验证失败：${error instanceof Error?error.message:'未知错误'}`)}
else if(environment.NOTIFICATION_DRIVER==='smtp')add('smtp-external','warning','SMTP 尚未执行外部连接验证；使用 --external 可只验证连接和认证')
const result={ok:!checks.some(item=>item.status==='error'),mode:local?'local':'production',external,summary:{passed:checks.filter(item=>item.status==='pass').length,warnings:checks.filter(item=>item.status==='warning').length,errors:checks.filter(item=>item.status==='error').length},checks}
if(json)console.log(JSON.stringify(result,null,2));else{for(const item of checks)console.log(`${item.status==='pass'?'✓':item.status==='warning'?'!':'×'} ${item.message}`);console.log(`结果：${result.ok?'通过':'未通过'} · ${result.summary.passed} 通过 / ${result.summary.warnings} 提醒 / ${result.summary.errors} 错误`)}
if(!result.ok)process.exitCode=1
