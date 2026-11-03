// Explicit, local-only acceptance. Never print source paths, names or chat text.
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm,stat,rename} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {performance} from 'node:perf_hooks'
import {convertLegacyWorkBuddyExport} from '../shared/workbuddy-chat-contract.mjs'
import {readChatFile} from '../shared/workbuddy-chat-files.mjs'
import {configureInbox,WorkBuddyInbox,bindingId} from '../server/lib/workbuddy-inbox.mjs'
import {WorkBuddyChatService} from '../server/lib/workbuddy-chat-service.mjs'

const args=process.argv.slice(2),arg=name=>args[args.indexOf(name)+1]
if(!args.includes('--source-dir')||!args.includes('--yes')){
 console.error('用法：node scripts/accept-workbuddy-local-sample.mjs --source-dir /本机导出目录 --yes [--expect-messages 数量] [--expect-media 数量] [--media-overrides /补导原图目录]')
 process.exit(2)
}
const sourceDir=resolve(arg('--source-dir')),mediaOverridesDir=args.includes('--media-overrides')?resolve(arg('--media-overrides')):undefined,root=await mkdtemp('/private/tmp/quexin-private-acceptance-')
const options={projectRoot:process.cwd(),dataRoot:join(root,'service'),inboxRoot:join(root,'exchange'),ownerId:'acceptance-owner',spaceId:'acceptance-space'}
const user={id:options.ownerId,tokenHash:'isolated-test-login'},checks={},timings={}
let stage='source-integrity',output,modelCalls=0,originalHashes
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const sourceHashes=async()=>{
 const bytes=await readChatFile(sourceDir,'chat.json',64*1024*1024,{privateMode:false}),value=JSON.parse(bytes)
 const paths=new Set(value.chats.flatMap(day=>day.messages.flatMap(message=>[...String(message.text??'').matchAll(/\[图片:([^\]]+)\]/g)].map(match=>match[1]))))
 const result=[hash(bytes)]
 for(const path of [...paths].sort())result.push(hash(await readChatFile(sourceDir,path,25*1024*1024,{privateMode:false})))
 return result
}
try{
 originalHashes=await sourceHashes()
 stage='convert';let start=performance.now()
 const first=await convertLegacyWorkBuddyExport({...options,sourceDir,mediaOverridesDir,conversationId:'acceptance-conversation',batchId:'complete',jobId:'complete-job'})
 timings.convertMs=Math.round(performance.now()-start)
 const counts={messages:first.manifest.totals.messages,media:first.manifest.totals.media,chunks:first.manifest.chunks.length,mediaOverridesUsed:first.summary.mediaOverridesUsed}
 if(args.includes('--expect-messages'))assert.equal(counts.messages,Number(arg('--expect-messages')))
 if(args.includes('--expect-media'))assert.equal(counts.media,Number(arg('--expect-media')))
 checks.completeSample=true
 await configureInbox(options)
 const inbox=new WorkBuddyInbox(options),provider={publicConfig:()=>({enabled:false,provider:'disabled',model:'',maxSources:6,maxSourceChars:1000}),run:()=>{modelCalls++;throw Error('MODEL_CALL_FORBIDDEN')}}
 const service=new WorkBuddyChatService({...options,store:{currentSpace:async()=>({space:{id:options.spaceId}})},provider,verifyPassword:async()=>false})
 const run=(action,body={},actor=user)=>service.run(action,{expectedOwnerId:actor.id,...(action==='status'?{}:{expectedSpaceId:options.spaceId}),...body},actor)
 stage='approval';const discovered=await run('status'),found=discovered.batches.find(item=>item.batchId==='complete')
 assert.equal(found.status,'waiting');assert.equal((await inbox.queryArchive('stats')).messages,0)
 assert.equal('text' in found,false);checks.approvalBeforeBody=true
 stage='archive';start=performance.now()
 const receipt=await run('receive',{batchId:'complete',digest:found.digest,consent:true})
 timings.archiveMs=Math.round(performance.now()-start);assert.equal(receipt.added,counts.messages)
 checks.archive=true
 stage='pagination';start=performance.now();const ids=new Set();let cursor='',sample
 do{
  const page=await inbox.queryArchive('search',{conversationId:'acceptance-conversation',limit:100,cursor})
  for(const item of page.items){assert.ok(!ids.has(item.messageId));ids.add(item.messageId);sample??=item;assert.ok(item.snippet.length<=500)}
  cursor=page.nextCursor??''
 }while(cursor)
 assert.equal(ids.size,counts.messages);timings.allPagesMs=Math.round(performance.now()-start)
 const original=await run('message',{conversationId:sample.conversationId,messageId:sample.messageId})
 assert.ok(original.sources[0].chunkLine>0);assert.equal(original.sources[0].batchId,'complete')
 checks.paginationAndSources=true
 stage='replay';const replay=await run('receive',{batchId:'complete',digest:found.digest,consent:true});assert.equal(replay.replayed,true)
 checks.sameBatchReplay=true
 stage='overlap';await convertLegacyWorkBuddyExport({...options,sourceDir,mediaOverridesDir,conversationId:'acceptance-conversation',batchId:'overlap',jobId:'overlap-job'})
 const overlapStatus=await run('status'),duplicate=await run('receive',{batchId:'overlap',digest:overlapStatus.batches.find(row=>row.batchId==='overlap').digest,consent:true})
 assert.equal(duplicate.added,0);assert.equal(duplicate.duplicates,counts.messages);checks.crossBatchDedup=true
 stage='increment';const incrementalSource=join(root,'synthetic-increment');await mkdir(incrementalSource,{mode:0o700})
 await writeFile(join(incrementalSource,'chat.json'),JSON.stringify({self:'acceptance-self',partner:'acceptance-partner',total:1,range:['2099-01-01','2099-01-01'],chats:[{date:'2099-01-01',messages:[{id:'synthetic-increment',sender:'我',time:'12:00',text:'SYNTHETIC_INCREMENT_ONLY'}]}]}),{mode:0o600})
 await convertLegacyWorkBuddyExport({...options,sourceDir:incrementalSource,conversationId:'acceptance-conversation',batchId:'increment',jobId:'increment-job'})
 const incrementalStatus=await run('status'),increment=await run('receive',{batchId:'increment',digest:incrementalStatus.batches.find(row=>row.batchId==='increment').digest,consent:true})
 assert.equal(increment.added,1);assert.equal(increment.totalMessages,counts.messages+1);checks.increment=true
 stage='restart';const restarted=new WorkBuddyInbox(options);assert.equal((await restarted.synchronize()).ok,true);assert.equal((await restarted.queryArchive('stats')).messages,counts.messages+1);checks.restart=true
 stage='folder-offline';await rename(options.inboxRoot,options.inboxRoot+'-offline');assert.equal((await inbox.status()).health.status,'unavailable');await rename(options.inboxRoot+'-offline',options.inboxRoot);assert.equal((await restarted.synchronize()).ok,true);checks.folderRecovery=true
 stage='isolation';const other={id:'other-account',tokenHash:'other-login'};assert.equal((await run('status',{},other)).health.status,'not_configured');await assert.rejects(()=>run('message',{conversationId:sample.conversationId,messageId:sample.messageId},other));checks.accountIsolation=true
 stage='permissions';const db=join(options.dataRoot,'workbuddy-archive',bindingId(options.ownerId,options.spaceId),'chat.sqlite')
 assert.equal((await stat(db)).mode&0o777,0o600);assert.equal((await stat(options.inboxRoot)).mode&0o777,0o700)
 for(const part of [...first.manifest.chunks.map(row=>row.file),...first.manifest.media.map(row=>row.path)])assert.equal((await stat(join(first.summary.ready,part))).mode&0o777,0o600)
 checks.privatePermissions=true;assert.equal(modelCalls,0);checks.noModelCalls=true
 stage='source-integrity';assert.deepEqual(await sourceHashes(),originalHashes);checks.sourceUnchanged=true
 output={ok:true,date:new Date().toISOString(),counts,checks,timings,modelCalls}
}catch(error){
 // Assertion stacks and fs errors can contain raw contents/paths; emit only a
 // constrained code and stage, even when a real private sample fails.
 output={ok:false,date:new Date().toISOString(),stage,code:/^[A-Z_0-9]+$/.test(error?.code??'')?error.code:'ACCEPTANCE_FAILED',checks,timings,modelCalls}
 process.exitCode=1
}finally{
 await rm(root,{recursive:true,force:true})
 output.temporaryCopiesRemoved=true
 const reportRoot=join(process.cwd(),'test-results/workbuddy-final');await mkdir(reportRoot,{recursive:true})
 await writeFile(join(reportRoot,'local-sample-summary.json'),JSON.stringify(output,null,2)+'\n',{mode:0o600})
 console.log(JSON.stringify(output,null,2))
}
