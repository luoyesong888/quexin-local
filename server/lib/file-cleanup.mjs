export async function retryFileCleanup({pool,mediaStore,exportStore,limit=200}){
 const client=await pool.connect();let completed=0,failed=0
 try{
  await client.query('BEGIN')
  const rows=(await client.query('SELECT * FROM quexin.file_cleanup_jobs ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED',[limit])).rows
  for(const row of rows){
   try{
    if(row.kind==='media')await mediaStore.remove({objectKey:row.object_key,thumbnailKey:row.thumbnail_key})
    else await exportStore.remove(row.object_key)
    await client.query('DELETE FROM quexin.file_cleanup_jobs WHERE id=$1',[row.id]);completed++
   }catch{
    await client.query("UPDATE quexin.file_cleanup_jobs SET attempts=attempts+1,last_error='文件清理失败，等待重试' WHERE id=$1",[row.id]);failed++
   }
  }
  await client.query('COMMIT');return{completed,failed}
 }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}
