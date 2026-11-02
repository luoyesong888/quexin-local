import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {MemoryStore} from '../server/lib/memory-store.mjs'
import {PostgresStore} from '../server/lib/postgres-store.mjs'
import {encryptCapsule,decryptCapsule} from '../server/lib/capsule-crypto.mjs'
const stores=[['memory',()=>new MemoryStore()]];if(process.env.CAPSULE_TEST_DATABASE_URL)stores.push(['postgres',()=>new PostgresStore(process.env.CAPSULE_TEST_DATABASE_URL)])
test('AES-GCM 胶囊使用错误密钥无法解密',()=>{const encrypted=encryptCapsule('未来正文','right-key');assert.equal(decryptCapsule(encrypted,'right-key'),'未来正文');assert.throws(()=>decryptCapsule(encrypted,'wrong-key'))})
for(const [backend,make] of stores)test(`${backend} 胶囊未到期不返回正文、到期授权和成员清理`,async()=>{const store=make(),users=[];let space
 try{for(const name of ['胶囊甲','胶囊乙','空间外'])users.push(await store.createUser({email:`capsule-${randomUUID()}@example.test`,displayName:name,passwordHash:'x'}));space=(await store.createSpace(users[0].id,{name:'胶囊空间',displayName:'胶囊甲'})).space;const invite=await store.createInvite(users[0].id,space.id,1);await store.acceptInvite(users[1].id,invite.code,'胶囊乙')
  const encrypted=encryptCapsule('CAPSULE_SECRET_BODY','capsule-key'),future=new Date(Date.now()+3600000).toISOString(),capsule=await store.createCapsule(users[0].id,space.id,{title:'未来的信',unlockAt:future,visibility:'shared'},encrypted)
  const list=await store.capsulesFor(users[1].id,space.id);assert.equal(list[0].canOpen,false);assert.ok(!JSON.stringify(list).includes('ciphertext'));assert.ok(!JSON.stringify(list).includes('CAPSULE_SECRET_BODY'));await assert.rejects(()=>store.capsuleForOpen(users[1].id,space.id,capsule.id),e=>e.code==='CAPSULE_LOCKED');await assert.rejects(()=>store.capsulesFor(users[2].id,space.id))
  if(backend==='memory')store.capsules.get(capsule.id).unlockAt=new Date(Date.now()-1000).toISOString();else await store.withUser(users[0].id,client=>client.query('UPDATE quexin.sealed_capsules SET unlock_at=now()-interval \'1 second\' WHERE id=$1',[capsule.id]))
  const opened=await store.capsuleForOpen(users[1].id,space.id,capsule.id);assert.equal(decryptCapsule(opened,'capsule-key'),'CAPSULE_SECRET_BODY');await assert.rejects(()=>store.deleteCapsule(users[1].id,space.id,capsule.id));await store.deleteCapsule(users[0].id,space.id,capsule.id);await assert.rejects(()=>store.capsuleForOpen(users[0].id,space.id,capsule.id))
  const own=await store.createCapsule(users[0].id,space.id,{title:'退出即清理',unlockAt:future,visibility:'private'},encryptCapsule('PRIVATE','capsule-key'));await store.endMembership(users[0].id,false);assert.equal((await store.capsulesFor(users[1].id,space.id)).some(item=>item.id===own.id),false)
 }finally{for(const user of users)if(await store.userById(user.id))await store.endMembership(user.id,true);await store.close()}})
