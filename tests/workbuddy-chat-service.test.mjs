import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,rm,stat} from 'node:fs/promises'
import {join} from 'node:path'
import {WorkBuddyChatService} from '../server/lib/workbuddy-chat-service.mjs'
import {WorkBuddyInbox,configureInbox} from '../server/lib/workbuddy-inbox.mjs'
import {convertLegacyWorkBuddyExport} from '../shared/workbuddy-chat-contract.mjs'

async function fixture(t){
 const root=await mkdtemp('/private/tmp/quexin-chat-service-');t.after(()=>rm(root,{recursive:true,force:true}))
 const options={projectRoot:process.cwd(),dataRoot:join(root,'service'),inboxRoot:join(root,'exchange'),ownerId:'alice',spaceId:'space'}
 await configureInbox(options)
 const sourceDir=join(root,'source');await mkdir(sourceDir,{mode:0o700})
 await writeFile(join(sourceDir,'chat.json'),JSON.stringify({self:'我',partner:'对方',total:2,range:['2026-11-01','2026-11-01'],chats:[{date:'2026-11-01',messages:[{sender:'我',time:'10:00',text:'喜欢海边咖啡 SYNTHETIC_SELECTED'},{sender:'对方',time:'10:01',text:'不能自动发送 SYNTHETIC_UNSELECTED'}]}]}))
 const batch=await convertLegacyWorkBuddyExport({...options,sourceDir,conversationId:'couple',batchId:'batch',jobId:'job'})
 const calls=[],user={id:'alice',tokenHash:'session-a',passwordHash:'test-hash'},store={currentSpace:async()=>({space:{id:options.spaceId}})}
 let time=1_000,model='test-model'
 const provider={publicConfig:()=>({enabled:true,model,provider:'Test',maxSources:6,maxSourceChars:1000}),run:async(kind,payload)=>{calls.push({kind,payload});return{candidates:[{title:'海边咖啡',body:'喜欢海边咖啡',kind:'偏好',date:'',sourceLine:1,sensitive:false}]}}}
 const service=new WorkBuddyChatService({...options,store,provider,verifyPassword:async value=>value==='correct',clock:()=>time})
 const run=(action,body={},actor=user,settings)=>service.run(action,{expectedOwnerId:actor.id,...(action==='status'?{}:{expectedSpaceId:options.spaceId}),...body},actor,settings)
 const discover=()=>run('status')
 const receive=async()=>{const found=await discover();return run('receive',{batchId:'batch',digest:found.batches[0].digest,consent:true})}
 const preview=async()=>{const found=await run('search',{conversationId:'couple',query:'SELECTED'});return run('preview',{refs:[{conversationId:'couple',messageId:found.items[0].messageId}]})}
 return{root,options,sourceDir,batch,service,user,run,discover,receive,preview,calls,store,provider,advance:()=>{time+=300_001},changeModel:()=>{model='changed'}}
}

test('清单发现不读正文、不建立归档、不发送模型；确认卡包含真实范围',async t=>{
 const f=await fixture(t),chunk=join(f.options.inboxRoot,'space/ready/batch',f.batch.manifest.chunks[0].file)
 await writeFile(chunk,'坏的正文，不应在发现时读取')
 const result=await f.discover()
 assert.equal(result.batches[0].status,'waiting');assert.equal(result.batches[0].counts.messages,2)
 assert.equal(result.batches[0].summary.participants.length,2)
 assert.ok(!JSON.stringify(result).includes('SYNTHETIC_SELECTED'));assert.equal(f.calls.length,0)
 await assert.rejects(()=>stat(join(f.options.dataRoot,'workbuddy-archive')),{code:'ENOENT'})
 await assert.rejects(()=>f.receive(),error=>['HASH_MISMATCH','INVALID_JSON','SIZE_MISMATCH'].includes(error.code))
 assert.equal((await f.discover()).batches[0].status,'failed')
})

test('确认读取原子归档、重复点击幂等，检索与原文保留来源',async t=>{
 const f=await fixture(t);assert.equal((await f.receive()).added,2);assert.equal((await f.receive()).replayed,true)
 const result=await f.run('search',{conversationId:'couple',query:'海边'})
 assert.equal(result.items.length,1)
 const row=result.items[0],original=await f.run('message',{conversationId:row.conversationId,messageId:row.messageId})
 assert.equal(original.sources[0].batchId,'batch');assert.equal(original.sources[0].chunkLine,1)
 assert.equal((await f.discover()).stats.messages,2);assert.equal(f.calls.length,0)
})

test('身份、空间和额外磁盘参数不能由网页伪造，同空间另一账号无权读取',async t=>{
 const f=await fixture(t);await f.receive()
 await assert.rejects(()=>f.run('status',{expectedOwnerId:'mallory'}),{code:'ACCOUNT_CHANGED'})
 await assert.rejects(()=>f.run('search',{expectedSpaceId:'other',conversationId:'couple'}),{code:'SCOPE_CHANGED'})
 await assert.rejects(()=>f.run('status',{ownerId:'alice',inboxRoot:f.root}),{code:'VALIDATION_FAILED'})
 const other={id:'bob',tokenHash:'session-b'},status=await f.run('status',{},other)
 assert.equal(status.health.status,'not_configured');assert.deepEqual(status.batches,[])
 await assert.rejects(()=>f.run('search',{conversationId:'couple'},other),{code:'NOT_CONFIGURED'})
 f.store.currentSpace=async()=>null
 await assert.rejects(()=>f.run('search',{conversationId:'couple'}),{code:'SCOPE_CHANGED'})
})

test('模型仅收到预览中的选中片段，确认单次使用且候选强制私密',async t=>{
 const f=await fixture(t);await f.receive();const preview=await f.preview()
 assert.equal(f.calls.length,0)
 const payload={previewId:preview.previewId,digest:preview.digest,mode:'model',consent:true}
 await assert.rejects(()=>f.run('organize',{...payload,consent:false}),{code:'VALIDATION_FAILED'})
 const result=await f.run('organize',payload)
 assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0].payload.lines,preview.lines)
 assert.ok(JSON.stringify(f.calls).includes('SYNTHETIC_SELECTED'));assert.ok(!JSON.stringify(f.calls).includes('SYNTHETIC_UNSELECTED'))
 assert.equal(result.candidates[0].sensitive,true);assert.equal(result.candidates[0].excerpt.source.batchId,'batch')
 await assert.rejects(()=>f.run('organize',payload),{code:'PREVIEW_EXPIRED'})
 const state=await readFile(join(new WorkBuddyInbox(f.options).control,'state.json'),'utf8')
 assert.ok(!state.includes('SYNTHETIC'));assert.ok(!state.includes(preview.previewId))
})

test('过期、切换登录会话、配置变化和停用文件夹都使发送确认失效',async t=>{
 const f=await fixture(t);await f.receive()
 const organize=(p,actor=f.user)=>f.run('organize',{previewId:p.previewId,digest:p.digest,mode:'model',consent:true},actor)
 let p=await f.preview();f.advance();await assert.rejects(()=>organize(p),{code:'PREVIEW_EXPIRED'})
 p=await f.preview();await assert.rejects(()=>organize(p,{...f.user,tokenHash:'new-login'}),{code:'PREVIEW_EXPIRED'})
 f.changeModel();await assert.rejects(()=>organize(p),{code:'PREVIEW_EXPIRED'})
 p=await f.preview();await configureInbox({...f.options,enabled:false});await assert.rejects(()=>organize(p),{code:'APPROVAL_REQUIRED'})
 assert.equal(f.calls.length,0)
})

test('本地整理、选中上限、失效消息与错误输出不外发或伪造成功',async t=>{
 const f=await fixture(t);await f.receive();const p=await f.preview()
 const result=await f.run('organize',{previewId:p.previewId,digest:p.digest,mode:'local',consent:true})
 assert.equal(result.candidates[0].kind,'偏好');assert.equal(result.candidates[0].date,'');assert.equal(f.calls.length,0)
 await assert.rejects(()=>f.run('preview',{refs:Array.from({length:7},()=>({conversationId:'couple',messageId:'absent'}))}),{code:'VALIDATION_FAILED'})
 await assert.rejects(()=>f.run('preview',{refs:[{conversationId:'couple',messageId:'absent'}]}),{code:'WORKBUDDY_UNAVAILABLE'})
 f.provider.run=async()=>{throw new Error('Upstream might echo SYNTHETIC_SELECTED api-key')}
 const again=await f.preview();await assert.rejects(()=>f.run('organize',{previewId:again.previewId,digest:again.digest,mode:'model',consent:true}),error=>error.code==='MODEL_FAILED'&&!error.message.includes('SYNTHETIC'))
})

test('新文件夹连接要求密码，取消前置请求不产生读取授权',async t=>{
 const f=await fixture(t)
 await assert.rejects(()=>f.run('connect',{inboxRoot:f.options.inboxRoot,currentPassword:'bad',consent:true}),{code:'INVALID_CREDENTIALS'})
 assert.equal((await f.run('connect',{inboxRoot:f.options.inboxRoot,currentPassword:'correct',consent:true})).connected,true)
 const found=await f.discover(),abort=new AbortController();abort.abort()
 await assert.rejects(()=>f.run('receive',{batchId:'batch',digest:found.batches[0].digest,consent:true},f.user,{signal:abort.signal}),{code:'CANCELLED'})
 assert.equal((await new WorkBuddyInbox(f.options).state()).entries.batch.approval,null)
})

test('并发提交同一预览只允许一次模型调用',async t=>{
 const f=await fixture(t);await f.receive();const preview=await f.preview()
 const body={previewId:preview.previewId,digest:preview.digest,mode:'model',consent:true}
 const results=await Promise.allSettled([f.run('organize',body),f.run('organize',body)])
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1)
 assert.equal(results.find(result=>result.status==='rejected').reason.code,'PREVIEW_EXPIRED')
 assert.equal(f.calls.length,1)
})
