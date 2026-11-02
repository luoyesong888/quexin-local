import pg from 'pg'
import { mkdir,writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { decryptNotification } from './lib/notification-crypto.mjs'
import nodemailer from 'nodemailer'
import { renderNotification } from './lib/notification-templates.mjs'

const connectionString=process.env.NOTIFICATION_DATABASE_URL??process.env.MAINTENANCE_DATABASE_URL,secret=process.env.NOTIFICATION_ENCRYPTION_KEY
if(!connectionString||!secret)throw new Error('通知投递器需要 NOTIFICATION_DATABASE_URL 和 NOTIFICATION_ENCRYPTION_KEY')
const {Pool}=pg,pool=new Pool({connectionString,max:2}),once=process.argv.includes('--once'),intervalMs=Math.max(5_000,Number(process.env.NOTIFICATION_INTERVAL_MS??15_000)),leaseMs=Math.max(30_000,Number(process.env.NOTIFICATION_LEASE_MS??300_000)),outbox=resolve(process.env.NOTIFICATION_OUTBOX??'.local-data/notification-outbox')
const driver=process.env.NOTIFICATION_DRIVER??(process.env.SMTP_URL?'smtp':process.env.NOTIFICATION_WEBHOOK_URL?'webhook':'local'),from=process.env.MAIL_FROM??'鹊信 <no-reply@quexin.local>'
const transporter=driver==='smtp'?nodemailer.createTransport(process.env.SMTP_URL,{pool:true}):driver==='json'?nodemailer.createTransport({jsonTransport:true}):null
async function deliver(job,payload){
  const content=renderNotification(job.kind,payload,{origin:process.env.PUBLIC_ORIGIN})
  if(driver==='webhook'){const response=await fetch(process.env.NOTIFICATION_WEBHOOK_URL,{method:'POST',headers:{'content-type':'application/json',...(process.env.NOTIFICATION_WEBHOOK_TOKEN?{authorization:`Bearer ${process.env.NOTIFICATION_WEBHOOK_TOKEN}`}:{})},body:JSON.stringify({recipient:job.recipient,kind:job.kind,...content})});if(!response.ok)throw new Error(`Webhook HTTP ${response.status}`);return{provider:'webhook',messageId:response.headers.get('x-message-id'),accepted:[job.recipient],rejected:[]}}
  if(transporter){const info=await transporter.sendMail({from,to:job.recipient,...content});if(driver==='json'){await mkdir(outbox,{recursive:true,mode:0o700});await writeFile(resolve(outbox,`${job.id}.json`),typeof info.message==='string'?info.message:JSON.stringify(info.message),{mode:0o600})}return{provider:driver,messageId:info.messageId??null,accepted:info.accepted??[job.recipient],rejected:info.rejected??[]}}
  await mkdir(outbox,{recursive:true,mode:0o700});await writeFile(resolve(outbox,`${job.id}.json`),JSON.stringify({from,to:job.recipient,kind:job.kind,...content,deliveredAt:new Date().toISOString()},null,2),{mode:0o600});return{provider:'local',messageId:`local-${job.id}`,accepted:[job.recipient],rejected:[]}
}
let running=false
async function claimJobs(){
  const client=await pool.connect()
  try{
    await client.query('BEGIN')
    await client.query(`UPDATE quexin.notification_jobs SET status='retry',claimed_at=NULL,last_error=COALESCE(last_error,'投递进程中断，租约到期后重新领取'),next_attempt_at=now() WHERE status='sending' AND claimed_at<now()-($1||' milliseconds')::interval`,[String(leaseMs)])
    const ready=(await client.query(`SELECT id FROM quexin.notification_jobs WHERE status IN ('pending','retry') AND next_attempt_at<=now() ORDER BY created_at LIMIT 20 FOR UPDATE SKIP LOCKED`)).rows.map(row=>row.id)
    const jobs=ready.length?(await client.query(`UPDATE quexin.notification_jobs SET status='sending',claimed_at=now(),last_attempt_at=now(),attempts=attempts+1 WHERE id=ANY($1::uuid[]) RETURNING *`,[ready])).rows:[]
    await client.query('COMMIT')
    return jobs
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}
async function run(){
  if(running)return
  running=true
  try{
    const jobs=await claimJobs()
    for(const job of jobs)try{
      const receipt=await deliver(job,decryptNotification(job,secret))
      await pool.query(`UPDATE quexin.notification_jobs SET status='sent',sent_at=now(),claimed_at=NULL,last_error=NULL,provider=$2,provider_message_id=$3,accepted=$4,rejected=$5 WHERE id=$1`,[job.id,receipt.provider,receipt.messageId,JSON.stringify(receipt.accepted),JSON.stringify(receipt.rejected)])
    }catch(error){
      const status=job.attempts>=5?'dead':'retry',delay=Math.min(3600,30*2**Math.max(0,job.attempts-1)),message=error instanceof Error?error.message:String(error)
      await pool.query(`UPDATE quexin.notification_jobs SET status=$2,claimed_at=NULL,last_error=$3,next_attempt_at=now()+($4||' seconds')::interval WHERE id=$1`,[job.id,status,message,String(delay)])
      if(status==='dead')await pool.query(`INSERT INTO quexin.system_alerts(severity,source,code,message,details) SELECT 'critical','notification','NOTIFICATION_DEAD','通知投递连续失败，已停止自动重试',$2::jsonb WHERE NOT EXISTS(SELECT 1 FROM quexin.system_alerts WHERE code='NOTIFICATION_DEAD' AND resolved_at IS NULL AND details->>'jobId'=$1)`,[job.id,JSON.stringify({jobId:job.id,kind:job.kind,recipientDomain:String(job.recipient).split('@')[1]??'unknown'})])
    }
    if(jobs.length)console.log(`通知投递完成：${jobs.length} 项`)
  }finally{running=false}
}
if(driver==='smtp'&&process.env.SMTP_VERIFY_ON_START!=='false'){await transporter.verify();console.log('SMTP 连接与认证检查通过')}
await run();if(once){transporter?.close?.();await pool.end();process.exit(0)}const timer=setInterval(()=>void run().catch(error=>console.error('通知投递失败',error)),intervalMs);for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{clearInterval(timer);transporter?.close?.();void pool.end().finally(()=>process.exit(0))})
