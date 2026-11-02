import assert from 'node:assert/strict'
import { access,mkdtemp,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { LocalMediaStore } from '../server/lib/local-media-store.mjs'
import { LocalExportStore } from '../server/lib/local-export-store.mjs'
import { runMaintenance } from '../server/lib/maintenance-core.mjs'

const connectionString=process.env.MAINTENANCE_DATABASE_URL??'postgres://127.0.0.1:5432/quexin_test',root=await mkdtemp(join(tmpdir(),'quexin-maintenance-')),mediaStore=new LocalMediaStore(join(root,'media')),exportStore=new LocalExportStore(join(root,'exports')),{Pool}=pg,pool=new Pool({connectionString,max:2}),now=new Date('2026-10-29T02:00:00.000Z')
const ids={ownerDue:randomUUID(),ownerKeep:randomUUID(),spaceDue:randomUUID(),spaceKeep:randomUUID(),expiredExport:randomUUID(),dueExport:randomUUID(),staleMedia:randomUUID(),dueMedia:randomUUID(),activeMedia:randomUUID()}
const key={expired:`${ids.expiredExport}.json.gz`,dueExport:`${ids.dueExport}.json.gz`,stale:`${ids.spaceKeep}/${ids.staleMedia}/image.webp`,dueMedia:`${ids.spaceDue}/${ids.dueMedia}/image.webp`,active:`${ids.spaceKeep}/${ids.activeMedia}/image.webp`}
let runId=null
const exists=async path=>access(path).then(()=>true).catch(()=>false)
try{
  await exportStore.write(ids.expiredExport,{test:'expired'});await exportStore.write(ids.dueExport,{test:'due-space'})
  await mediaStore.atomicWrite(key.stale,Buffer.from('stale'));await mediaStore.atomicWrite(key.dueMedia,Buffer.from('due'));await mediaStore.atomicWrite(key.active,Buffer.from('active'))
  const client=await pool.connect()
  try{
    await client.query('BEGIN')
    await client.query(`INSERT INTO quexin.app_users(id,email,display_name,password_hash) VALUES($1,$2,'维护到期','x'),($3,$4,'维护保留','x')`,[ids.ownerDue,`maintenance-due-${ids.ownerDue}@example.test`,ids.ownerKeep,`maintenance-keep-${ids.ownerKeep}@example.test`])
    await client.query(`INSERT INTO quexin.couple_spaces(id,name,created_by) VALUES($1,'到期空间',$2),($3,'保留空间',$4)`,[ids.spaceDue,ids.ownerDue,ids.spaceKeep,ids.ownerKeep])
    await client.query(`INSERT INTO quexin.space_members(space_id,user_id,role,display_name) VALUES($1,$2,'owner','维护到期'),($3,$4,'owner','维护保留')`,[ids.spaceDue,ids.ownerDue,ids.spaceKeep,ids.ownerKeep])
    await client.query(`INSERT INTO quexin.space_deletion_requests(space_id,requested_by,scheduled_at) VALUES($1,$2,$3)`,[ids.spaceDue,ids.ownerDue,new Date(now.getTime()-1000)])
    await client.query(`INSERT INTO quexin.data_export_jobs(id,space_id,requested_by,status,object_key,sha256,byte_size,expires_at) VALUES($1,$2,$3,'ready',$4,$5,10,$6),($7,$8,$9,'ready',$10,$11,10,$12)`,[ids.expiredExport,ids.spaceKeep,ids.ownerKeep,key.expired,'a'.repeat(64),new Date(now.getTime()-1000),ids.dueExport,ids.spaceDue,ids.ownerDue,key.dueExport,'b'.repeat(64),new Date(now.getTime()+86400000)])
    await client.query(`INSERT INTO quexin.media_objects(id,space_id,owner_id,visibility,object_key,content_type,byte_size,sha256,status,created_at) VALUES($1,$2,$3,'shared',$4,'image/webp',5,$5,'pending',$6),($7,$8,$9,'shared',$10,'image/webp',3,$11,'ready',$12),($13,$14,$15,'shared',$16,'image/webp',6,$17,'ready',$18)`,[ids.staleMedia,ids.spaceKeep,ids.ownerKeep,key.stale,'c'.repeat(64),new Date(now.getTime()-25*60*60_000),ids.dueMedia,ids.spaceDue,ids.ownerDue,key.dueMedia,'d'.repeat(64),now,ids.activeMedia,ids.spaceKeep,ids.ownerKeep,key.active,'e'.repeat(64),now])
    await client.query(`INSERT INTO quexin.auth_sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3),($4,$5,$6)`,['1'.repeat(64),ids.ownerKeep,new Date(now.getTime()-1000),'2'.repeat(64),ids.ownerKeep,new Date(now.getTime()+86400000)])
    await client.query(`INSERT INTO quexin.account_tokens(user_id,purpose,token_hash,expires_at) VALUES($1,'verify_email',$2,$3)`,[ids.ownerKeep,'3'.repeat(64),new Date(now.getTime()-1000)])
    await client.query('COMMIT')
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
  const result=await runMaintenance({pool,now,mediaStore,exportStore})
  assert.deepEqual({expiredExports:result.expiredExports,deletedSpaces:result.deletedSpaces,removedMedia:result.removedMedia,expiredSessions:result.expiredSessions,expiredTokens:result.expiredTokens},{expiredExports:1,deletedSpaces:1,removedMedia:1,expiredSessions:1,expiredTokens:1})
  const state=await pool.query(`SELECT (SELECT count(*) FROM quexin.couple_spaces WHERE id=$1)::integer AS due_spaces,(SELECT count(*) FROM quexin.couple_spaces WHERE id=$2)::integer AS kept_spaces,(SELECT count(*) FROM quexin.media_objects WHERE id=$3)::integer AS stale_media,(SELECT count(*) FROM quexin.media_objects WHERE id=$4)::integer AS active_media,(SELECT count(*) FROM quexin.auth_sessions WHERE token_hash=$5)::integer AS active_sessions`,[ids.spaceDue,ids.spaceKeep,ids.staleMedia,ids.activeMedia,'2'.repeat(64)])
  assert.deepEqual(state.rows[0],{due_spaces:0,kept_spaces:1,stale_media:0,active_media:1,active_sessions:1})
  assert.equal(await exists(exportStore.pathFor(key.expired)),false);assert.equal(await exists(exportStore.pathFor(key.dueExport)),false);assert.equal(await exists(mediaStore.pathFor(key.stale)),false);assert.equal(await exists(mediaStore.pathFor(key.dueMedia)),false);assert.equal(await exists(mediaStore.pathFor(key.active)),true)
  const run=(await pool.query(`SELECT id,status FROM quexin.maintenance_runs ORDER BY id DESC LIMIT 1`)).rows[0];runId=run.id;assert.equal(run.status,'success')
  console.log('维护调度测试通过：过期导出、到期空间、媒体、会话和令牌均按预期清理')
}finally{
  await pool.query(`DELETE FROM quexin.app_users WHERE id=ANY($1::uuid[])`,[[ids.ownerDue,ids.ownerKeep]]).catch(()=>undefined)
  if(runId)await pool.query(`DELETE FROM quexin.maintenance_runs WHERE id=$1`,[runId]).catch(()=>undefined)
  await pool.end();await rm(root,{recursive:true,force:true})
}
