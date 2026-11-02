import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {MemoryStore} from '../server/lib/memory-store.mjs'
import {PostgresStore} from '../server/lib/postgres-store.mjs'
const stores=[['memory',()=>new MemoryStore()]]
if(process.env.CARE_TEST_DATABASE_URL)stores.push(['postgres',()=>new PostgresStore(process.env.CARE_TEST_DATABASE_URL)])
for(const [backend,make] of stores)test(`${backend} 关怀分享、撤回、过期与成员隔离`,async()=>{
 const store=make(),users=[];let space
 try{
  for(const name of ['关怀甲','关怀乙','空间外'])users.push(await store.createUser({email:`care-${randomUUID()}@example.test`,displayName:name,passwordHash:'x'}))
  space=(await store.createSpace(users[0].id,{name:'关怀空间',displayName:'关怀甲'})).space;const invite=await store.createInvite(users[0].id,space.id,1);await store.acceptInvite(users[1].id,invite.code,'关怀乙')
  const first=await store.publishCare(users[0].id,space.id,{need:'想被听见',message:'请先听我说完',hours:8});assert.equal(first.version,1);assert.equal((await store.careSignalsFor(users[1].id,space.id))[0].message,'请先听我说完')
  const updated=await store.publishCare(users[0].id,space.id,{need:'想安静',message:'',hours:1});assert.equal(updated.version,2);assert.equal((await store.careSignalsFor(users[1].id,space.id))[0].need,'想安静')
  if(backend==='memory')store.careSignals.get(`${space.id}:${users[0].id}`).expiresAt=new Date(Date.now()-1000).toISOString();else await store.withUser(users[0].id,client=>client.query('UPDATE quexin.care_signals SET expires_at=now()-interval \'1 second\' WHERE space_id=$1 AND user_id=$2',[space.id,users[0].id]));assert.deepEqual(await store.careSignalsFor(users[1].id,space.id),[])
  await store.publishCare(users[0].id,space.id,{need:'想安静',message:'',hours:1})
  await assert.rejects(()=>store.publishCare(users[0].id,space.id,{need:'替我诊断',message:'',hours:8}));await assert.rejects(()=>store.publishCare(users[0].id,space.id,{need:'想聊聊',message:'x'.repeat(281),hours:8}));await assert.rejects(()=>store.careSignalsFor(users[2].id,space.id))
  await store.revokeCare(users[0].id,space.id);assert.deepEqual(await store.careSignalsFor(users[1].id,space.id),[]);await assert.rejects(()=>store.revokeCare(users[0].id,space.id))
  await store.publishCare(users[0].id,space.id,{need:'想聊聊',message:'不会随退出保留',hours:8});await store.endMembership(users[0].id,false);assert.deepEqual(await store.careSignalsFor(users[1].id,space.id),[])
 }finally{for(const user of users)if(await store.userById(user.id))await store.endMembership(user.id,true);await store.close()}
})
