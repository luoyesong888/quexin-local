import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { MemoryStore } from '../server/lib/memory-store.mjs'
import { PostgresStore } from '../server/lib/postgres-store.mjs'

const stores=[['memory',()=>new MemoryStore()]]
if(process.env.ACCOUNT_TEST_DATABASE_URL)stores.push(['postgres',()=>new PostgresStore(process.env.ACCOUNT_TEST_DATABASE_URL)])
for(const [backend,create] of stores)test(`${backend} 共同空间权限、并发与幂等`,async()=>{
  const store=create(),users=[];let space
  try{
    for(const displayName of ['共同甲','共同乙','空间外'])users.push(await store.createUser({email:`companion-${randomUUID()}@example.test`,displayName,passwordHash:'test-only'}))
    space=(await store.createSpace(users[0].id,{name:'并发测试',displayName:'共同甲'})).space
    const invite=await store.createInvite(users[0].id,space.id,1)
    await store.acceptInvite(users[1].id,invite.code,'共同乙')
    await assert.rejects(()=>store.companion(users[2].id,space.id),e=>e.status===403)
    await assert.rejects(()=>store.companionAction(users[2].id,space.id,{commandId:randomUUID(),kind:'touch'}),e=>e.status===403)
    const touch={commandId:randomUUID(),kind:'touch'},feed={commandId:randomUUID(),kind:'feed'}
    await Promise.all([store.companionAction(users[0].id,space.id,touch),store.companionAction(users[0].id,space.id,touch),store.companionAction(users[1].id,space.id,feed)])
    let state=await store.companion(users[0].id,space.id)
    assert.equal(state.pet.feathers,5);assert.equal(state.revision,2);assert.equal(state.events.length,2)
    await Promise.all(Array.from({length:10},(_,i)=>store.companionAction(users[i%2].id,space.id,{commandId:randomUUID(),kind:i%2?'touch':'feed'})))
    state=await store.companion(users[1].id,space.id);assert.equal(state.pet.feathers,30);assert.equal(state.revision,12)
    const updated=await store.companionAction(users[1].id,space.id,{commandId:randomUUID(),kind:'profile',profile:{selfName:'小满',partnerName:'阿澄',since:'2024-06-21'},theme:'cosmos',privateDraft:'不应保存'})
    assert.deepEqual(updated.profile,{ownerName:'阿澄',partnerName:'小满',since:'2024-06-21'});assert.equal(updated.theme,undefined);assert.equal(updated.privateDraft,undefined)
    await assert.rejects(()=>store.companionAction(users[0].id,space.id,{commandId:randomUUID(),kind:'profile',profile:{selfName:'甲',partnerName:'乙',since:'2026-02-31'}}),e=>e.status===400)
    assert.equal((await store.companion(users[0].id,space.id)).revision,13)
    for(const kind of ['preen','deliver','explore'])await store.companionAction(users[0].id,space.id,{commandId:randomUUID(),kind})
    state=await store.companion(users[1].id,space.id);assert.equal(state.pet.feathers,35);assert.deepEqual(state.events.slice(0,3).map(event=>event.kind),['explore','deliver','preen'])
    const memoryId=randomUUID(),body='一段经过双方确认、足够具体并且带有来源的共同回忆。'.repeat(5),create={commandId:randomUUID(),entity:'record',entityId:memoryId,operation:'create',expectedRevision:null,payload:{id:memoryId,title:'共同成长回忆',body,date:'2026-10-31',kind:'回忆',source:'双方确认',status:'confirmed',visibility:'shared',mediaId:'photo'},clientTime:new Date().toISOString()}
    assert.equal((await store.sync(users[0].id,space.id,[create])).accepted.length,1);state=await store.companion(users[1].id,space.id);assert.equal(state.pet.feathers,43);assert.deepEqual(state.growthSources.map(source=>source.sourceId),[memoryId])
    await store.sync(users[0].id,space.id,[{...create,commandId:randomUUID(),operation:'update',expectedRevision:1,payload:{...create.payload,title:'更新标题'}}]);assert.equal((await store.companion(users[1].id,space.id)).pet.feathers,43)
    await store.sync(users[0].id,space.id,[{...create,commandId:randomUUID(),operation:'withdraw',expectedRevision:2,payload:{}}]);state=await store.companion(users[1].id,space.id);assert.equal(state.pet.feathers,43);assert.deepEqual(state.growthSources,[]);assert.ok(!JSON.stringify(state.events).includes('共同成长回忆'))
  }finally{
    if(space)await store.deleteSpaceNow(users[0].id,space.id)
    if(backend==='postgres')await store.pool.query('DELETE FROM quexin.app_users WHERE id=ANY($1::uuid[])',[users.map(u=>u.id)])
    await store.close()
  }
})
