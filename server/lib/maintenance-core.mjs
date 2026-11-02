import { LocalMediaStore } from './local-media-store.mjs'
import { LocalExportStore } from './local-export-store.mjs'
import {retryFileCleanup} from './file-cleanup.mjs'

export async function runMaintenance({pool,now=new Date(),mediaStore=new LocalMediaStore(),exportStore=new LocalExportStore()}){
  const startedAt=new Date(),client=await pool.connect(),files={media:[],exports:[]}
  const result={expiredExports:0,deletedSpaces:0,removedMedia:0,expiredSessions:0,expiredTokens:0}
  try{
    await client.query('BEGIN')
    const expiredExports=await client.query(`DELETE FROM quexin.data_export_jobs WHERE expires_at<=$1 RETURNING object_key`,[now]);result.expiredExports=expiredExports.rowCount;files.exports.push(...expiredExports.rows.map(row=>row.object_key).filter(Boolean))
    const staleBefore=new Date(now.getTime()-24*60*60_000)
    const staleMedia=await client.query(`DELETE FROM quexin.media_objects WHERE deleted_at IS NOT NULL OR (status='pending' AND created_at<=$1) RETURNING object_key,thumbnail_key`,[staleBefore]);result.removedMedia=staleMedia.rowCount;for(const row of staleMedia.rows)files.media.push({objectKey:row.object_key,thumbnailKey:row.thumbnail_key})
    const due=(await client.query(`SELECT s.id FROM quexin.couple_spaces s JOIN quexin.space_deletion_requests d ON d.space_id=s.id WHERE d.cancelled_at IS NULL AND d.scheduled_at<=$1 FOR UPDATE OF s`,[now])).rows
    for(const item of due){
      const media=(await client.query(`SELECT object_key,thumbnail_key FROM quexin.media_objects WHERE space_id=$1`,[item.id])).rows,exports=(await client.query(`SELECT object_key FROM quexin.data_export_jobs WHERE space_id=$1`,[item.id])).rows
      files.media.push(...media.map(row=>({objectKey:row.object_key,thumbnailKey:row.thumbnail_key})));files.exports.push(...exports.map(row=>row.object_key).filter(Boolean));await client.query(`DELETE FROM quexin.couple_spaces WHERE id=$1`,[item.id]);result.deletedSpaces+=1
    }
    const sessions=await client.query(`DELETE FROM quexin.auth_sessions WHERE expires_at<=$1 OR (revoked_at IS NOT NULL AND revoked_at<=$1::timestamptz-interval '7 days')`,[now]);result.expiredSessions=sessions.rowCount
    const tokens=await client.query(`DELETE FROM quexin.account_tokens WHERE expires_at<=$1 OR (used_at IS NOT NULL AND used_at<=$1::timestamptz-interval '7 days')`,[now]);result.expiredTokens=tokens.rowCount
    await client.query('COMMIT')
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
  const fileErrors=[]
  for(const media of files.media)try{await mediaStore.remove(media)}catch(error){fileErrors.push(error instanceof Error?error.message:String(error))}
  for(const key of files.exports)try{await exportStore.remove(key)}catch(error){fileErrors.push(error instanceof Error?error.message:String(error))}
  const cleanup=await retryFileCleanup({pool,mediaStore,exportStore})
  if(cleanup.failed)fileErrors.push(`${cleanup.failed} 项文件仍在等待清理重试`)
  const completedAt=new Date(),status=fileErrors.length?'partial':'success'
  await pool.query(`INSERT INTO quexin.maintenance_runs(started_at,completed_at,status,expired_exports,deleted_spaces,removed_media,expired_sessions,expired_tokens,details) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[startedAt,completedAt,status,result.expiredExports,result.deletedSpaces,result.removedMedia,result.expiredSessions,result.expiredTokens,{fileErrors}])
  if(fileErrors.length)await pool.query(`INSERT INTO quexin.system_alerts(severity,source,code,message,details) VALUES('warning','maintenance','FILE_CLEANUP_PARTIAL','维护数据库清理完成，但部分物理文件未能移除',$1)`,[{fileErrors}])
  return{...result,status,startedAt:startedAt.toISOString(),completedAt:completedAt.toISOString(),fileErrors}
}
