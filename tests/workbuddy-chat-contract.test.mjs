import test from 'node:test'
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,mkdir,readFile,rm,stat,writeFile,symlink} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createHash} from 'node:crypto'
import {convertLegacyWorkBuddyExport,validateWorkBuddyChatManifest,WORKBUDDY_CHAT_FORMAT} from '../shared/workbuddy-chat-contract.mjs'
import sharp from 'sharp'
import {inspectBatch,validateBatch} from '../server/lib/workbuddy-inbox-validator.mjs'

const exec=promisify(execFile),digest=value=>createHash('sha256').update(value).digest('hex')
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'quexin-workbuddy-chat-')),source=join(root,'legacy'),inbox=join(root,'inbox');await mkdir(join(source,'images'),{recursive:true})
 const image=Buffer.from('synthetic-image-for-contract-test');await writeFile(join(source,'images','memory.jpg'),image)
 const legacy={partner:'对方',self:'我',total:3,days:2,range:['2026-10-01','2026-10-02'],chats:[{date:'2026-10-01',messages:[{sender:'我',time:'08:30',text:'早上好'},{sender:'对方',time:'08:31:02',text:'今天看到一张图 [图片:images/memory.jpg]'}]},{date:'2026-10-02',messages:[{sender:'我',time:'2026-10-02T12:00:00+08:00',text:'下周一起去散步'}]}]};await writeFile(join(source,'chat.json'),JSON.stringify(legacy,null,2))
 return{root,source,inbox,image}
}

test('F1 兼容转换器生成私有、可校验且可追溯的 ready 批次',async()=>{
 const f=await fixture()
 try{
  const options={sourceDir:f.source,inboxRoot:f.inbox,spaceId:'space-demo',conversationId:'conversation-demo',jobId:'job-demo',createdAt:'2026-11-03T00:00:00.000Z'},dry=await convertLegacyWorkBuddyExport({...options,dryRun:true})
  assert.equal(dry.summary.messages,3);assert.equal(dry.summary.media,1);assert.equal(dry.summary.chunks,1);assert.equal(dry.summary.dryRun,true)
  const result=await convertLegacyWorkBuddyExport(options),ready=result.summary.ready,manifest=JSON.parse(await readFile(join(ready,'manifest.json'),'utf8')),chunkText=await readFile(join(ready,'messages-0001.json'),'utf8'),chunk=JSON.parse(chunkText),media=await readFile(join(ready,manifest.media[0].path))
  assert.equal(manifest.format,WORKBUDDY_CHAT_FORMAT);assert.deepEqual(validateWorkBuddyChatManifest(manifest),{ok:true,errors:[]});assert.equal(manifest.totals.messages,3);assert.equal(manifest.totals.media,1);assert.equal(manifest.chunks[0].sha256,digest(chunkText));assert.equal(manifest.media[0].sha256,digest(media));assert.deepEqual(media,f.image)
  assert.equal(chunk.messages.length,3);assert.deepEqual(chunk.messages.map(message=>message.sequence),[1,2,3]);assert.ok(chunk.messages.every(message=>/^fallback-[a-f0-9]{64}-\d+$/.test(message.messageId)));assert.equal(chunk.messages[1].mediaRefs[0].sha256,manifest.media[0].sha256)
  assert.equal((await stat(f.inbox)).mode&0o777,0o700);assert.equal((await stat(ready)).mode&0o777,0o700);assert.equal((await stat(join(ready,'manifest.json'))).mode&0o777,0o600);assert.equal((await stat(join(ready,manifest.media[0].path))).mode&0o777,0o600)
  await assert.rejects(()=>convertLegacyWorkBuddyExport({...options,jobId:'job-repeat'}),/EEXIST|ENOTEMPTY|exist/i)
 }finally{await rm(f.root,{recursive:true,force:true})}
})

test('F1 拒绝越界图片、缺失图片和无效 manifest',async()=>{
 const f=await fixture()
 try{
  const chatPath=join(f.source,'chat.json'),legacy=JSON.parse(await readFile(chatPath,'utf8'));legacy.chats[0].messages[1].text='[图片:../outside.jpg]';await writeFile(chatPath,JSON.stringify(legacy));await assert.rejects(()=>convertLegacyWorkBuddyExport({sourceDir:f.source,inboxRoot:f.inbox,spaceId:'space-demo',conversationId:'conversation-demo',dryRun:true}),/越界/)
  legacy.chats[0].messages[1].text='[图片:images/missing.jpg]';await writeFile(chatPath,JSON.stringify(legacy));await assert.rejects(()=>convertLegacyWorkBuddyExport({sourceDir:f.source,inboxRoot:f.inbox,spaceId:'space-demo',conversationId:'conversation-demo',dryRun:true}),error=>error.code==='MISSING_FILE')
  assert.equal(validateWorkBuddyChatManifest({format:'future-version'}).ok,false);assert.equal(validateWorkBuddyChatManifest({...{format:WORKBUDDY_CHAT_FORMAT,jobId:'job',batchId:'batch',spaceId:'space',conversationId:'conversation',sourceApp:'wechat',extractorVersion:'test',createdAt:'2026-11-03T00:00:00.000Z',timezone:'Asia/Shanghai',participants:[{id:'self',label:'我'}],range:{from:'2026-01-01',to:'2026-01-02'},totals:{messages:1,media:0},chunks:[{file:'../escape.json',count:1,sha256:'a'.repeat(64)}],media:[],status:'ready'}}).ok,false)
 }finally{await rm(f.root,{recursive:true,force:true})}
})

test('F1 CLI 可生成不含密钥的 WorkBuddy 固定任务',async()=>{
 const f=await fixture()
 try{const result=await exec(process.execPath,['scripts/workbuddy-chat-bridge.mjs','task','--source',f.source,'--inbox',f.inbox,'--space-id','space-demo','--conversation-id','conversation-demo']);assert.match(result.stdout,/WorkBuddy × 鹊信/);assert.match(result.stdout,/workbuddy-chat-bridge\.mjs convert/);assert.match(result.stdout,/space-demo/);assert.equal(/API[_ -]?Key|password/i.test(result.stdout),false)}finally{await rm(f.root,{recursive:true,force:true})}
})

test('补导原图可按相同相对路径交接并完整校验，不覆盖原导出',async()=>{
 const f=await fixture(),replacement=join(f.root,'replacement')
 try{
  const original=await readFile(join(f.source,'chat.json')),bytes=await sharp({create:{width:12,height:12,channels:3,background:'#abc'}}).jpeg().toBuffer()
  await mkdir(join(replacement,'images'),{recursive:true});await writeFile(join(replacement,'images/memory.jpg'),bytes)
  const input={sourceDir:f.source,inboxRoot:f.inbox,spaceId:'space',conversationId:'couple',jobId:'old'},old=await convertLegacyWorkBuddyExport(input),oldInfo=await inspectBatch(old.summary.ready,{spaceId:'space',batchId:old.summary.batchId})
  await assert.rejects(()=>validateBatch(old.summary.ready,{spaceId:'space',batchId:old.summary.batchId,expectedDigest:oldInfo.digest}),{code:'MEDIA_INVALID'})
  const result=JSON.parse((await exec(process.execPath,['scripts/workbuddy-chat-bridge.mjs','convert','--source',f.source,'--media-overrides',replacement,'--inbox',f.inbox,'--space-id','space','--conversation-id','couple','--job-id','repaired'])).stdout)
  assert.equal(result.mediaOverridesUsed,1);assert.equal(result.messages,3);assert.equal(result.media,1)
  const inspected=await inspectBatch(result.ready,{spaceId:'space',batchId:result.batchId})
  assert.equal((await validateBatch(result.ready,{spaceId:'space',batchId:result.batchId,expectedDigest:inspected.digest})).media,1)
  assert.equal(inspected.manifest.media[0].sha256,digest(bytes));assert.deepEqual(await readFile(join(f.source,'images/memory.jpg')),f.image);assert.deepEqual(await readFile(join(f.source,'chat.json')),original)
 }finally{await rm(f.root,{recursive:true,force:true})}
})

test('补导目录只补充声明图片，缺失时读取旧图，链接和项目内目录不可借道',async()=>{
 const f=await fixture(),replacement=join(f.root,'replacement')
 try{
  await mkdir(join(replacement,'images'),{recursive:true});await writeFile(join(replacement,'irrelevant.txt'),'ignored')
  const input={sourceDir:f.source,mediaOverridesDir:replacement,inboxRoot:f.inbox,spaceId:'space',conversationId:'couple',dryRun:true}
  assert.equal((await convertLegacyWorkBuddyExport(input)).summary.mediaOverridesUsed,0)
  await symlink(join(f.source,'images/memory.jpg'),join(replacement,'images/memory.jpg'))
  await assert.rejects(()=>convertLegacyWorkBuddyExport(input),error=>['UNSAFE_PATH','UNSAFE_FILE'].includes(error.code))
  await assert.rejects(()=>convertLegacyWorkBuddyExport({...input,mediaOverridesDir:process.cwd()}),{code:'UNSAFE_PATH'})
  await assert.rejects(()=>convertLegacyWorkBuddyExport({...input,mediaOverridesDir:join(f.root,'absent')}))
 }finally{await rm(f.root,{recursive:true,force:true})}
})
