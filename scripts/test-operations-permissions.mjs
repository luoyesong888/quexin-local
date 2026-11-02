import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import pg from 'pg'
import {encryptNotification} from '../server/lib/notification-crypto.mjs'

const adminUrl=process.env.OPERATIONS_ADMIN_URL,appUrl=process.env.OPERATIONS_APP_URL
if(!adminUrl||!appUrl)throw new Error('权限测试需要 OPERATIONS_ADMIN_URL 和 OPERATIONS_APP_URL')
const {Client}=pg,admin=new Client({connectionString:adminUrl}),app=new Client({connectionString:appUrl}),userId=randomUUID(),jobId=randomUUID(),email=`operations-${userId}@example.test`,encrypted=encryptNotification({token:'private-token'},'operations-test-key')
const denied=async(fn)=>{try{await fn();return false}catch(error){return error?.code==='42501'||/permission denied|row-level security/i.test(String(error?.message))}}
try{
  await admin.connect();await app.connect()
  const role=(await app.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];assert.equal(role.rolsuper||role.rolbypassrls,false)
  await admin.query(`INSERT INTO quexin.app_users(id,email,display_name,password_hash,email_verified_at) VALUES($1,$2,'权限测试','x',now())`,[userId,email])
  await admin.query(`INSERT INTO quexin.notification_jobs(id,recipient,kind,ciphertext,iv,auth_tag) VALUES($1,$2,'verify_email',$3,$4,$5)`,[jobId,email,encrypted.ciphertext,encrypted.iv,encrypted.authTag])
  await app.query(`SELECT set_config('app.user_id',$1,false)`,[userId])
  const visible=await app.query('SELECT id,status,attempts FROM quexin.notification_jobs WHERE id=$1',[jobId]);assert.equal(visible.rowCount,1)
  assert.equal(await denied(()=>app.query('SELECT ciphertext FROM quexin.notification_jobs WHERE id=$1',[jobId])),true)
  assert.equal(await denied(()=>app.query(`UPDATE quexin.notification_jobs SET status='sent' WHERE id=$1`,[jobId])),true)
  assert.equal(await denied(()=>app.query(`INSERT INTO quexin.maintenance_runs(started_at,completed_at,status) VALUES(now(),now(),'success')`)),true)
  assert.equal(await denied(()=>app.query(`INSERT INTO quexin.system_alerts(severity,source,code,message) VALUES('warning','test','FORGED','forged')`)),true)
  assert.equal(await denied(()=>app.query('SELECT details FROM quexin.system_alerts')),true)
  console.log('运维权限测试通过：应用角色可读状态摘要，但不能读取密文/内部详情或写维护、告警、投递状态')
}finally{await admin.query('DELETE FROM quexin.app_users WHERE id=$1',[userId]).catch(()=>{});await app.end().catch(()=>{});await admin.end().catch(()=>{})}
