import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {MemoryStore} from '../server/lib/memory-store.mjs'
import {PostgresStore} from '../server/lib/postgres-store.mjs'
import pg from 'pg'
import {retryFileCleanup} from '../server/lib/file-cleanup.mjs'
const backends=[['memory',()=>new MemoryStore()]]
if(process.env.LIFECYCLE_TEST_DATABASE_URL)backends.push(['postgres',()=>new PostgresStore(process.env.LIFECYCLE_TEST_DATABASE_URL)])
for(const [backend,make] of backends)test(`${backend} 撤回、导出、退出与注销`,async t=>{
 const store=make(),users=[]
 const user=async name=>{const u=await store.createUser({email:`lifecycle-${randomUUID()}@example.test`,displayName:name,passwordHash:'test-hash'});users.push(u);return u}
 const command=(entityId,operation,revision,payload={})=>({commandId:randomUUID(),entity:'record',entityId,operation,expectedRevision:revision,payload,clientTime:new Date().toISOString()})
 const payload={title:'共同回忆',body:'OLD_PRIVATE_BODY',kind:'回忆',status:'confirmed',date:'2026-10-30',visibility:'shared'}
 try{
  const a=await user('作者甲'),b=await user('伴侣乙'),c=await user('旁观丙'),d=await user('独立丁'),space=(await store.createSpace(a.id,{name:'生命周期空间',displayName:a.displayName})).space
  const invite=await store.createInvite(a.id,space.id,1);await store.acceptInvite(b.id,invite.code,b.displayName)
  const independent=(await store.createSpace(d.id,{name:'不应改变的空间',displayName:d.displayName})).space;await store.companionAction(d.id,independent.id,{commandId:randomUUID(),kind:'touch'})
  await t.test('撤回保留作者资料，照片和旧导出不再对伴侣开放',async()=>{
   await store.sync(a.id,space.id,[command('r','create',null,payload)])
   const photo=await store.createMedia(a.id,space.id,{filename:'photo.jpg',visibility:'shared',contentType:'image/jpeg',byteSize:1,sha256:'a'.repeat(64),entityType:'record',entityId:'r'})
   await store.completeMedia(a.id,photo.id,{objectKey:'test/photo.webp',thumbnailKey:'test/thumb.webp',outputContentType:'image/webp',storedByteSize:1,width:1,height:1})
   const job=await store.createExportJob(b.id,space.id);await store.completeExportJob(b.id,job.id,{objectKey:'export.gz',sha256:'b'.repeat(64),byteSize:1});assert.ok(await store.exportJobForRead(b.id,job.id))
   const withdrawn=await store.sync(a.id,space.id,[command('r','withdraw',1)]);assert.equal(withdrawn.accepted.length,1)
   assert.equal((await store.changes(a.id,space.id)).records.find(r=>r.id==='r').body,payload.body)
   const partner=await store.changes(b.id,space.id);assert.ok(partner.events.some(e=>e.entityId==='r'&&e.operation==='delete'));assert.ok(!JSON.stringify(partner).includes(payload.body))
   await assert.rejects(()=>store.mediaForRead(b.id,photo.id));assert.equal((await store.mediaForRead(a.id,photo.id)).visibility,'private');await assert.rejects(()=>store.exportJobForRead(b.id,job.id))
   await assert.rejects(()=>store.createMedia(a.id,space.id,{filename:'new.png',visibility:'shared',contentType:'image/png',byteSize:1,sha256:'d'.repeat(64),entityType:'record',entityId:'r'}),e=>e.code==='VALIDATION_FAILED')
   await assert.rejects(()=>store.sync(c.id,space.id,[command('r','withdraw',1)]));await assert.rejects(()=>store.sync(b.id,space.id,[command('r','publish',2,payload)]))
   await assert.rejects(()=>store.sync(a.id,space.id,[command('r','update',2,payload)]),e=>e.code==='EXPLICIT_PUBLISH_REQUIRED')
   assert.equal((await store.sync(a.id,space.id,[command('r','publish',2,payload)])).accepted.length,1)
  })
  await t.test('过期应答和旧更新不能胜过作者撤回，导出生成中失效',async()=>{
   const pending=await store.createExportJob(b.id,space.id)
   await Promise.allSettled([store.sync(b.id,space.id,[command('r','update',3,{...payload,title:'同时编辑'})]),store.sync(a.id,space.id,[command('r','withdraw',1)])])
   assert.equal((await store.sharing(a.id,space.id)).entities.find(e=>e.id==='r').visibility,'private')
   assert.ok(!JSON.stringify(await store.changes(b.id,space.id)).includes(payload.body));await assert.rejects(()=>store.completeExportJob(b.id,pending.id,{objectKey:'late.gz',sha256:'c'.repeat(64),byteSize:1}))
  })
  await t.test('原本私有的内容重复撤回不会向伴侣广播标识',async()=>{
   await store.sync(a.id,space.id,[command('never-shared','create',null,{...payload,visibility:'private'})]);await store.sync(a.id,space.id,[command('never-shared','withdraw',1)])
   assert.ok(!JSON.stringify(await store.changes(b.id,space.id)).includes('never-shared'))
  })
  await t.test('删除标记与冲突响应不携带旧正文',async()=>{
   const current=(await store.sharing(a.id,space.id)).entities.find(e=>e.id==='r');await store.sync(a.id,space.id,[command('r','delete',current.revision)])
   const changes=await store.changes(a.id,space.id);assert.equal(changes.records.find(r=>r.id==='r').body,undefined)
   const conflict=await store.sync(a.id,space.id,[command('r','update',1,payload)]);assert.equal(conflict.accepted.length,0);assert.ok(!JSON.stringify(conflict).includes(payload.body))
  })
  await t.test('创建者退出后空间归伴侣，其他空间不受影响',async()=>{
   await store.sync(a.id,space.id,[command('leaving','create',null,payload)]);await store.sync(b.id,space.id,[command('keep','create',null,{...payload,body:'留下的成员资料'})])
   const result=await store.endMembership(a.id,false);assert.equal(result.remainingMember,true);assert.equal(await store.currentSpace(a.id),null)
   const left=await store.currentSpace(b.id);assert.equal(left.members.length,1);assert.equal(left.members[0].role,'owner');assert.ok(await store.createInvite(b.id,space.id,1))
   assert.ok(!JSON.stringify(await store.changes(b.id,space.id)).includes(payload.body));assert.ok((await store.changes(b.id,space.id)).records.some(r=>r.id==='keep'&&!r.deletedAt))
   assert.ok(!JSON.stringify(await store.changes(b.id,space.id)).includes('never-shared'))
   await assert.rejects(()=>store.sync(a.id,space.id,[command('late','create',null,payload)]));assert.equal((await store.companion(d.id,independent.id)).profile.ownerName,d.displayName)
  })
  await t.test('注销撤销全部会话与令牌，邮箱可重新注册，最后成员空间删除',async()=>{
   await store.createSession({userId:b.id,tokenHash:'e'.repeat(64),expiresAt:new Date(Date.now()+100000).toISOString()});await store.createAccountToken({userId:b.id,purpose:'reset_password',tokenHash:'f'.repeat(64),expiresAt:new Date(Date.now()+100000).toISOString()})
   await store.endMembership(b.id,true);assert.equal(await store.userById(b.id),null);assert.equal(await store.sessionByHash('e'.repeat(64)),null);assert.equal(await store.resetPasswordWithToken('f'.repeat(64),'new'),null)
   const replacement=await store.createUser({email:b.email,displayName:'新账号',passwordHash:'new'});users.push(replacement);assert.notEqual(replacement.id,b.id)
   await store.endMembership(a.id,true);assert.equal(await store.userById(a.id),null)
  })
  if(backend==='postgres'&&process.env.LIFECYCLE_ADMIN_URL)await t.test('清理失败保留任务并可重试，普通应用角色不可读取任务',async()=>{
   const pool=new pg.Pool({connectionString:process.env.LIFECYCLE_ADMIN_URL,max:1}),id=randomUUID()
   try{
    await pool.query("INSERT INTO quexin.file_cleanup_jobs(id,kind,object_key) VALUES($1,'media','cleanup-test/image.webp')",[id])
    assert.equal((await store.pool.query('SELECT * FROM quexin.file_cleanup_jobs')).rowCount,0)
    await retryFileCleanup({pool,mediaStore:{remove:async()=>{throw Error('模拟磁盘失败')}},exportStore:{remove:async()=>{throw Error('模拟磁盘失败')}}})
    assert.equal((await pool.query('SELECT attempts FROM quexin.file_cleanup_jobs WHERE id=$1',[id])).rows[0].attempts,1)
    await retryFileCleanup({pool,mediaStore:{remove:async()=>{}},exportStore:{remove:async()=>{}}})
    assert.equal((await pool.query('SELECT 1 FROM quexin.file_cleanup_jobs WHERE id=$1',[id])).rowCount,0)
   }finally{await pool.query('DELETE FROM quexin.file_cleanup_jobs WHERE id=$1',[id]);await pool.end()}
  })
 }finally{for(const u of users)if(await store.userById(u.id))await store.endMembership(u.id,true);await store.close()}
})
