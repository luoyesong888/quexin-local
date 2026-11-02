import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { promisify } from 'node:util'
import { readFile,rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { encryptNotification,decryptNotification } from '../server/lib/notification-crypto.mjs'

const execFileAsync=promisify(execFile),key='notification-test-key',ids={success:randomUUID(),stale:randomUUID(),failure:randomUUID()},outbox='.local-data/notification-json-test',database=process.env.NOTIFICATION_DATABASE_URL??'postgres://127.0.0.1:5432/quexin_test',{Pool}=pg,pool=new Pool({connectionString:database,max:1}),encrypted=encryptNotification({token:'secret-test-token',expiresAt:'2026-10-30T00:00:00.000Z'},key)
const worker=(extra={})=>execFileAsync(process.execPath,['server/notification-worker.mjs','--once'],{env:{...process.env,NOTIFICATION_DATABASE_URL:database,NOTIFICATION_ENCRYPTION_KEY:key,NOTIFICATION_DRIVER:'json',NOTIFICATION_OUTBOX:outbox,NOTIFICATION_LEASE_MS:'30000',MAIL_FROM:'鹊信测试 <test@quexin.local>',...extra}})
const failureServer=createServer((_request,response)=>{response.writeHead(503);response.end('temporary failure')})
try{
  assert.equal(decryptNotification({...encrypted,auth_tag:encrypted.authTag},key).token,'secret-test-token')
  await pool.query(`INSERT INTO quexin.notification_jobs(id,recipient,kind,ciphertext,iv,auth_tag) VALUES($1,'notification@example.test','verify_email',$3,$4,$5),($2,'stale@example.test','verify_email',$3,$4,$5)`,[ids.success,ids.stale,encrypted.ciphertext,encrypted.iv,encrypted.authTag])
  await pool.query(`UPDATE quexin.notification_jobs SET status='sending',attempts=1,claimed_at=now()-interval '10 minutes' WHERE id=$1`,[ids.stale])
  await worker()
  const delivered=(await pool.query(`SELECT id,status,attempts,provider,provider_message_id,rejected,last_error FROM quexin.notification_jobs WHERE id=ANY($1::uuid[]) ORDER BY id`,[[ids.success,ids.stale]])).rows
  assert.equal(delivered.every(row=>row.status==='sent'),true);assert.equal(delivered.find(row=>row.id===ids.success).attempts,1);assert.equal(delivered.find(row=>row.id===ids.stale).attempts,2);assert.equal(delivered.every(row=>row.provider==='json'&&row.provider_message_id&&row.rejected.length===0&&!row.last_error),true)
  const message=JSON.parse(await readFile(`${outbox}/${ids.success}.json`,'utf8'));assert.match(message.subject,/验证邮箱/);assert.match(message.text,/secret-test-token/)

  await new Promise((resolve,reject)=>{failureServer.once('error',reject);failureServer.listen(0,'127.0.0.1',resolve)})
  const address=failureServer.address(),webhook=`http://127.0.0.1:${address.port}/notify`
  await pool.query(`INSERT INTO quexin.notification_jobs(id,recipient,kind,ciphertext,iv,auth_tag) VALUES($1,'failure@example.test','verify_email',$2,$3,$4)`,[ids.failure,encrypted.ciphertext,encrypted.iv,encrypted.authTag])
  for(let attempt=1;attempt<=5;attempt++){
    await worker({NOTIFICATION_DRIVER:'webhook',NOTIFICATION_WEBHOOK_URL:webhook})
    const row=(await pool.query('SELECT status,attempts,claimed_at,last_error FROM quexin.notification_jobs WHERE id=$1',[ids.failure])).rows[0]
    assert.equal(row.attempts,attempt);assert.equal(row.claimed_at,null);assert.match(row.last_error,/Webhook HTTP 503/);assert.equal(row.status,attempt===5?'dead':'retry')
    if(attempt<5)await pool.query('UPDATE quexin.notification_jobs SET next_attempt_at=now() WHERE id=$1',[ids.failure])
  }
  await worker({NOTIFICATION_DRIVER:'webhook',NOTIFICATION_WEBHOOK_URL:webhook})
  assert.equal((await pool.query('SELECT attempts FROM quexin.notification_jobs WHERE id=$1',[ids.failure])).rows[0].attempts,5)
  assert.equal(Number((await pool.query(`SELECT count(*) FROM quexin.system_alerts WHERE code='NOTIFICATION_DEAD' AND details->>'jobId'=$1`,[ids.failure])).rows[0].count),1)
  console.log('通知投递测试通过：加密、租约恢复、回执、指数退避、dead 告警与幂等均正常')
}finally{
  if(failureServer.listening)failureServer.close()
  await pool.query(`DELETE FROM quexin.system_alerts WHERE code='NOTIFICATION_DEAD' AND details->>'jobId'=$1`,[ids.failure]).catch(()=>undefined)
  await pool.query(`DELETE FROM quexin.notification_jobs WHERE id=ANY($1::uuid[])`,[Object.values(ids)]).catch(()=>undefined)
  await pool.end();await rm(outbox,{recursive:true,force:true})
}
