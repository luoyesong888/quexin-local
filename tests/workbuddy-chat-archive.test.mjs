import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,readFile,writeFile,rm,rename,stat,readdir,symlink} from 'node:fs/promises'
import {join} from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {performance} from 'node:perf_hooks'
import sharp from 'sharp'
import {configureInbox,WorkBuddyInbox,bindingId} from '../server/lib/workbuddy-inbox.mjs'
import {archiveOperation} from '../server/lib/workbuddy-chat-archive.mjs'
import {convertLegacyWorkBuddyExport,normalizeLegacyChat} from '../shared/workbuddy-chat-contract.mjs'
import {watchInbox} from '../server/lib/workbuddy-inbox.mjs'
import {digestText} from '../shared/workbuddy-chat-identity.mjs'

const exec=promisify(execFile),projectRoot=process.cwd(),secret='SYNTHETIC_CHAT_ONLY_NOT_A_REAL_PERSON'
const msg=(n,extra={})=>({sender:n%2?'我':'对方',time:new Date(Date.UTC(2026,10,1,1,0,n)).toISOString(),text:`${secret} ${n} 一起去海边`,...extra})
async function fixture(t){
 const root=await mkdtemp('/private/tmp/quexin-archive-');t.after(()=>rm(root,{recursive:true,force:true}))
 const options={projectRoot,dataRoot:join(root,'service'),inboxRoot:join(root,'exchange'),ownerId:'owner',spaceId:'space'}
 await configureInbox(options)
 const inbox=new WorkBuddyInbox(options)
 const archiveDir=join(options.dataRoot,'workbuddy-archive',bindingId(options.ownerId,options.spaceId))
 let jobs=0
 async function deliver(messages,{batchId='batch-'+(++jobs),conversationId='couple',image=false,imageCount=0}={}){
  const sourceDir=join(root,'source-'+(++jobs));await mkdir(sourceDir,{mode:0o700})
  if(image){await mkdir(join(sourceDir,'images'));await writeFile(join(sourceDir,'images/photo.png'),await sharp({create:{width:8,height:8,channels:3,background:'#8ac'}}).png().toBuffer())}
  if(imageCount){await mkdir(join(sourceDir,'images'),{recursive:true});const bytes=await sharp({create:{width:8,height:8,channels:3,background:'#8ac'}}).png().toBuffer();for(let i=0;i<imageCount;i++)await writeFile(join(sourceDir,'images',`photo-${i}.png`),bytes)}
  const groups=new Map();for(const message of messages){const date=message.date??'2026-11-01';if(!groups.has(date))groups.set(date,[]);groups.get(date).push(message)}
  const dates=[...groups.keys()].sort()
  await writeFile(join(sourceDir,'chat.json'),JSON.stringify({self:'我',partner:'对方',total:messages.length,range:[dates[0],dates.at(-1)],chats:[...groups.entries()].map(([date,messages])=>({date,messages}))}))
  const batch=await convertLegacyWorkBuddyExport({...options,sourceDir,conversationId,batchId,jobId:'job-'+jobs})
  await inbox.scan();const state=await inbox.state(),item=state.entries[batchId]
  return{...batch,batchId,digest:item.digest,sourceDir}
 }
 async function ingest(batch){await inbox.approve(batch.batchId,batch.digest,{archive:true});const result=await inbox.synchronize();assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.batches.find(item=>item.batchId===batch.batchId).status,'completed');return result.batches.find(item=>item.batchId===batch.batchId).archive}
 return{root,options,inbox,archiveDir,deliver,ingest}
}

test('归档须另行批准；完成后可检索片段、追溯消息与图片，磁盘权限正确',async t=>{
 const f=await fixture(t),batch=await f.deliver([msg(1),msg(2,{text:'海边照片[图片:images/photo.png]'})],{image:true})
 await f.inbox.approve(batch.batchId,batch.digest);await f.inbox.synchronize()
 await assert.rejects(()=>f.inbox.archive(batch.batchId),{code:'ARCHIVE_APPROVAL_REQUIRED'})
 await assert.rejects(()=>stat(f.archiveDir),{code:'ENOENT'})
 const imported=await f.ingest(batch);assert.equal(imported.added,2)
 const result=await f.inbox.queryArchive('search',{conversationId:'couple',query:'海边',senderId:'partner'});assert.equal(result.items.length,1);assert.equal(result.items[0].provenance.type,'workbuddy-chat')
 const message=await f.inbox.queryArchive('message',{conversationId:'couple',messageId:result.items[0].messageId});assert.equal(message.mediaRefs.length,1);assert.equal(message.sources[0].batchId,batch.batchId);assert.equal(message.sources[0].chunkLine,2);assert.equal(message.sources[0].manifestDigest,batch.digest)
 assert.equal((await stat(f.archiveDir)).mode&0o777,0o700);assert.equal((await stat(join(f.archiveDir,'chat.sqlite'))).mode&0o777,0o600)
 const state=await readFile(join(f.inbox.control,'state.json'),'utf8');assert.ok(!state.includes(secret));assert.ok(!(await readFile(join(f.options.inboxRoot,'space','processed',batch.batchId+'.json'),'utf8')).includes(secret))
 assert.deepEqual(await readdir(f.archiveDir),['chat.sqlite'])
})

test('同批次重放和跨批次重叠只新增新消息；重复文字及不同会话保留',async t=>{
 const f=await fixture(t),same=msg(2,{text:'同一秒连续说两次你好'})
 const first=await f.deliver([msg(1),same,same,msg(3)])
 assert.equal((await f.ingest(first)).added,4)
 assert.equal((await f.inbox.archive(first.batchId)).replayed,true)
 const second=await f.deliver([same,same,msg(3),msg(4)])
 const result=await f.ingest(second);assert.equal(result.added,1);assert.equal(result.duplicates,3)
 assert.equal((await f.inbox.queryArchive('stats')).messages,5)
 const other=await f.deliver([msg(1)],{conversationId:'other-couple'});assert.equal((await f.ingest(other)).added,1)
 const found=await f.inbox.queryArchive('search',{conversationId:'couple',query:'你好'});assert.equal(found.items.length,2)
 const detail=await f.inbox.queryArchive('message',{conversationId:'couple',messageId:found.items[0].messageId});assert.equal(detail.sources.length,2)
})

test('原始 ID 内容冲突时整批回滚，既有归档不会被覆盖',async t=>{
 const f=await fixture(t),first=await f.deliver([msg(1,{messageId:'original-1'})]);await f.ingest(first)
 const second=await f.deliver([msg(2,{messageId:'new-2'}),msg(1,{messageId:'original-1',text:'同一ID被篡改'})]);await f.inbox.approve(second.batchId,second.digest,{archive:true});await f.inbox.scan()
 await assert.rejects(()=>f.inbox.archive(second.batchId),{code:'MESSAGE_CONFLICT'})
 const stats=await f.inbox.queryArchive('stats');assert.equal(stats.messages,1);assert.equal(stats.batches,1)
 assert.equal((await f.inbox.queryArchive('search',{conversationId:'couple',query:'被篡改'})).items.length,0)
 assert.equal((await f.inbox.state()).entries[second.batchId].status,'failed')
})

test('重启补回已提交归档的状态，不依赖再次读取源文件',async t=>{
 const f=await fixture(t),batch=await f.deliver([msg(1)]);await f.inbox.approve(batch.batchId,batch.digest,{archive:true});await f.inbox.scan()
 const state=await f.inbox.state();state.entries[batch.batchId].status='processing';await f.inbox.save(state)
 await archiveOperation(f.options,'import',{batchId:batch.batchId,digest:batch.digest,root:batch.summary.ready})
 await rename(batch.summary.ready,join(f.root,'source-offline'))
 const restarted=new WorkBuddyInbox(f.options),result=await restarted.synchronize()
 assert.equal(result.ok,true);assert.equal(result.batches[0].status,'completed');assert.equal(result.batches[0].archive.replayed,true);assert.equal((await restarted.queryArchive('stats')).messages,1)
})

test('事务中取消会回滚并暂停归档，重新批准后不会重复写入',async t=>{
 const f=await fixture(t),first=await f.deliver([msg(0)]);await f.ingest(first)
 const batch=await f.deliver(Array.from({length:2001},(_,i)=>msg(i+1)));await f.inbox.approve(batch.batchId,batch.digest,{archive:true});await f.inbox.scan()
 const controller=new AbortController()
 await assert.rejects(()=>f.inbox.archive(batch.batchId,{signal:controller.signal,onProgress:()=>controller.abort()}),{code:'CANCELLED'})
 assert.equal((await f.inbox.queryArchive('stats')).messages,1)
 await new WorkBuddyInbox(f.options).synchronize();assert.equal((await f.inbox.queryArchive('stats')).messages,1)
 await f.inbox.approve(batch.batchId,batch.digest,{archive:true})
 const result=await new WorkBuddyInbox(f.options).synchronize();assert.equal(result.ok,true);assert.equal((await f.inbox.queryArchive('stats')).messages,2002)
})

test('进程在事务中崩溃后，重启从批次重新处理且不会留下半批数据',async t=>{
 const f=await fixture(t),batch=await f.deliver(Array.from({length:1001},(_,i)=>msg(i)));await f.inbox.approve(batch.batchId,batch.digest,{archive:true});await f.inbox.scan()
 const code="import {WorkBuddyInbox} from './server/lib/workbuddy-inbox.mjs';const input=JSON.parse(process.argv[1]);await new WorkBuddyInbox(input.options).archive(input.batchId,{onProgress:()=>process.exit(9)})"
 await assert.rejects(()=>exec(process.execPath,['--input-type=module','-e',code,JSON.stringify({options:f.options,batchId:batch.batchId})]),error=>error.code===9)
 assert.equal((await f.inbox.queryArchive('stats')).messages,0)
 const recovered=await new WorkBuddyInbox(f.options).synchronize();assert.equal(recovered.ok,true);assert.equal(recovered.batches[0].status,'completed');assert.equal((await f.inbox.queryArchive('stats')).messages,1001)
})

test('校验后的源文件被修改时，归档再次检查并拒绝写入',async t=>{
 const f=await fixture(t),batch=await f.deliver([msg(1)]);await f.inbox.approve(batch.batchId,batch.digest,{archive:true});await f.inbox.scan()
 await writeFile(join(batch.summary.ready,'messages-0001.json'),'invalid-private-text')
 await assert.rejects(()=>f.inbox.archive(batch.batchId),{code:'HASH_MISMATCH'})
 assert.equal((await f.inbox.queryArchive('stats')).messages,0)
})

test('分页采用固定快照；新增和迟到消息不打乱当前翻页，日期/发送者过滤生效',async t=>{
 const f=await fixture(t);await f.ingest(await f.deliver(Array.from({length:12},(_,i)=>msg(i+1))))
 const first=await f.inbox.queryArchive('search',{conversationId:'couple',query:'海边',limit:5});assert.equal(first.items.length,5);assert.ok(first.nextCursor)
 await f.ingest(await f.deliver([msg(0),msg(13,{date:'2026-11-02',time:'2026-11-02T01:00:00Z'})]))
 let cursor=first.nextCursor,all=[...first.items]
 while(cursor){const page=await f.inbox.queryArchive('search',{conversationId:'couple',query:'海边',limit:5,cursor});all.push(...page.items);cursor=page.nextCursor}
 assert.equal(all.length,12);assert.equal(new Set(all.map(item=>item.messageId)).size,12)
 const filtered=await f.inbox.queryArchive('search',{conversationId:'couple',from:'2026-11-02',to:'2026-11-02',senderId:'self'});assert.equal(filtered.items.length,1)
 const stats=await f.inbox.queryArchive('stats');assert.equal(stats.messages,14);assert.equal(stats.conversations[0].watermarkMs,Date.parse('2026-11-02T01:00:00Z'))
 await assert.rejects(()=>f.inbox.queryArchive('search',{conversationId:'couple',query:'changed-filter',cursor:first.nextCursor}),{code:'INVALID_QUERY'})
})

test('账号/空间隔离、停用、非法查询、数据库链接保护',async t=>{
 const f=await fixture(t);await f.ingest(await f.deliver([msg(1)]))
 const other={...f.options,ownerId:'other-owner'};await configureInbox({...other,inboxRoot:join(f.root,'other-exchange')});assert.equal((await new WorkBuddyInbox(other).queryArchive('stats')).messages,0)
 const otherSpace={...f.options,spaceId:'other-space'};await configureInbox(otherSpace);assert.equal((await new WorkBuddyInbox(otherSpace).queryArchive('search',{conversationId:'couple'})).items.length,0)
 for(const query of [{limit:101},{limit:0},{cursor:'notjson'},{from:'2026-99-99'},{cursor:Buffer.from('null').toString('base64url')},{query:'x'.repeat(201)}])await assert.rejects(()=>f.inbox.queryArchive('search',{conversationId:'couple',...query}),{code:'INVALID_QUERY'})
 assert.equal((await f.inbox.queryArchive('search',{conversationId:'couple',query:"' OR 1=1 --"})).items.length,0)
 await configureInbox({...f.options,enabled:false});await assert.rejects(()=>f.inbox.queryArchive('stats'),{code:'APPROVAL_REQUIRED'})
 await configureInbox(f.options);const file=join(f.archiveDir,'chat.sqlite');await rename(file,join(f.root,'db'));await symlink(join(f.root,'db'),file);await assert.rejects(()=>f.inbox.queryArchive('stats'),{code:'UNSAFE_PATH'})
})

test('上万条消息归档/搜索在后台线程完成，分页有上限且正文不会出现在运行状态',async t=>{
 const f=await fixture(t),batch=await f.deliver(Array.from({length:10_000},(_,i)=>msg(i,{text:i===8765?'仅出现一次的中文短词 海边':secret+' '+i+(i<264?`[图片:images/photo-${i}.png]`:'')})),{imageCount:264})
 await f.inbox.approve(batch.batchId,batch.digest,{archive:true});await f.inbox.scan()
 let ticks=0;const timer=setInterval(()=>ticks++,10);const begin=performance.now()
 let imported;try{imported=await f.inbox.archive(batch.batchId)}finally{clearInterval(timer)}
 const ingestMs=Math.round(performance.now()-begin),queryStart=performance.now(),page=await f.inbox.queryArchive('search',{conversationId:'couple',query:'海边',limit:10}),queryMs=Math.round(performance.now()-queryStart)
 assert.equal(imported.added,10_000);assert.equal(page.items.length,1);assert.ok(ticks>5);assert.ok(ingestMs<30_000);assert.ok(queryMs<5_000)
 assert.equal(JSON.stringify(await f.inbox.status()).includes(secret),false)
 t.diagnostic(JSON.stringify({syntheticMessages:10000,syntheticImages:264,ingestMs,queryMs,eventLoopTicks:ticks}))
})

test('消息 ID 不依赖导出序号，缺失时间不伪造为中午',()=>{
 const input=messages=>({self:'我',partner:'对方',total:messages.length,chats:[{date:'2026-11-01',messages}]})
 const first=normalizeLegacyChat(input([msg(1),msg(2)])).messages[1],second=normalizeLegacyChat(input([msg(2)])).messages[0]
 assert.equal(first.messageId,second.messageId)
 assert.throws(()=>normalizeLegacyChat(input([{sender:'我',text:'未知时间'}])),{code:'INVALID_MESSAGE'})
 assert.equal(normalizeLegacyChat(input([{sender:'我',time:'09:30',text:'时区'}]),{timezone:'UTC'}).messages[0].timestamp,'2026-11-01T09:30:00Z')
})

test('兼容 F1 旧批次的序号哈希，新的重叠导出不会重复；批次 ID 不允许改内容',async t=>{
 const f=await fixture(t),old=await f.deliver([msg(1),msg(2)])
 const file=join(old.summary.ready,'messages-0001.json'),data=JSON.parse(await readFile(file,'utf8'));data.messages.forEach(m=>{m.messageId=digestText([m.conversationId,m.senderId,m.timestamp,String(m.sequence),m.text].join('\u001f'))})
 const content=JSON.stringify(data);await writeFile(file,content);const manifestFile=join(old.summary.ready,'manifest.json'),manifest=JSON.parse(await readFile(manifestFile,'utf8'));manifest.chunks[0].sha256=digestText(content);await writeFile(manifestFile,JSON.stringify(manifest));await f.inbox.scan();old.digest=(await f.inbox.state()).entries[old.batchId].digest
 await f.ingest(old);const next=await f.deliver([msg(2),msg(3)]);const result=await f.ingest(next);assert.equal(result.added,1);assert.equal(result.duplicates,1)
 manifest.extractorVersion='changed';await writeFile(manifestFile,JSON.stringify(manifest));await f.inbox.scan();const changed=(await f.inbox.state()).entries[old.batchId];await f.inbox.approve(old.batchId,changed.digest,{archive:true});await f.inbox.scan();await assert.rejects(()=>f.inbox.archive(old.batchId),{code:'BATCH_CONFLICT'});assert.equal((await f.inbox.queryArchive('stats')).messages,3)
})

test('已批准归档的批次由监视器自动处理，CLI 返回检索片段',async t=>{
 const f=await fixture(t),batch=await f.deliver([msg(1)]);await f.inbox.approve(batch.batchId,batch.digest,{archive:true})
 let result;const stop=watchInbox(f.inbox,{intervalMs:30,onResult:value=>{result=value}});t.after(stop)
 const end=Date.now()+5000;while(Date.now()<end&&result?.batches[0]?.status!=='completed')await new Promise(resolve=>setTimeout(resolve,30));stop()
 assert.equal(result.batches[0].status,'completed')
 const flags=['--data-root',f.options.dataRoot,'--owner-id','owner','--space-id','space']
 const output=await exec(process.execPath,['scripts/workbuddy-inbox.mjs','search',...flags,'--conversation-id','couple','--query','海边']);assert.equal(JSON.parse(output.stdout).items.length,1);assert.equal(output.stderr.includes(secret),false)
})
