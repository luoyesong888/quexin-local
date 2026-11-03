import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,mkdir,readFile,writeFile,rm,chmod,rename,symlink,link,readdir,stat} from 'node:fs/promises'
import {join} from 'node:path'
import sharp from 'sharp'
import {convertLegacyWorkBuddyExport} from '../shared/workbuddy-chat-contract.mjs'
import {configureInbox,WorkBuddyInbox,watchInbox} from '../server/lib/workbuddy-inbox.mjs'
import {INBOX_LIMITS,validateBatch} from '../server/lib/workbuddy-inbox-validator.mjs'
import {startInboxMonitor} from '../server/lib/workbuddy-inbox-monitor.mjs'

const exec=promisify(execFile),hash=value=>createHash('sha256').update(value).digest('hex'),projectRoot=process.cwd()
const sentinel='PRIVATE_TEST_MESSAGE_DO_NOT_LOG'
async function fixture(t,{count=2}={}){
 const root=await mkdtemp('/private/tmp/quexin-inbox-');t.after(()=>rm(root,{recursive:true,force:true}))
 const sourceDir=join(root,'source'),inboxRoot=join(root,'exchange'),dataRoot=join(root,'service')
 await mkdir(join(sourceDir,'images'),{recursive:true})
 const image=await sharp({create:{width:8,height:8,channels:3,background:'#bb9988'}}).png().toBuffer()
 await writeFile(join(sourceDir,'images/photo.png'),image)
 await writeFile(join(sourceDir,'chat.json'),JSON.stringify({self:'测试甲',partner:'测试乙',total:count,range:['2026-11-01','2026-11-01'],chats:[{date:'2026-11-01',messages:Array.from({length:count},(_,i)=>({sender:i%2?'对方':'我',time:'09:30:00',text:sentinel+' '+i+(i===0?'[图片:images/photo.png]':'')}))}]}))
 const options={inboxRoot,dataRoot,projectRoot,spaceId:'test-space',ownerId:'test-owner'}
 await configureInbox(options)
 const result=await convertLegacyWorkBuddyExport({...options,sourceDir,conversationId:'test-conversation',jobId:'test-job'})
 return{root,sourceDir,...options,...result,inbox:new WorkBuddyInbox(options),ready:result.summary.ready}
}
async function approve(f){const scan=await f.inbox.scan();assert.equal(scan.ok,true);const item=scan.batches.find(x=>x.batchId===f.manifest.batchId);assert.ok(item);await f.inbox.approve(item.batchId,item.digest);return item}
async function rewriteManifest(f,mutate){const path=join(f.ready,'manifest.json'),manifest=JSON.parse(await readFile(path,'utf8'));mutate(manifest);await writeFile(path,JSON.stringify(manifest)+'\n',{mode:0o600});return manifest}
async function waitUntil(fn){const end=Date.now()+3000;while(Date.now()<end){if(await fn())return;await new Promise(resolve=>setTimeout(resolve,25))}assert.fail('watcher did not reach expected state')}

test('仅发现清单；明确批准后校验，staging 半成品始终不读；状态不含正文',async t=>{
 const f=await fixture(t),chunk=join(f.ready,'messages-0001.json')
 await mkdir(join(f.inboxRoot,f.spaceId,'staging','partial'),{mode:0o700});await writeFile(join(f.inboxRoot,f.spaceId,'staging','partial','manifest.json'),'not json')
 const original=await readFile(chunk);await writeFile(chunk,'BROKEN '+sentinel)
 const scan=await f.inbox.scan();assert.equal(scan.batches.length,1);assert.equal(scan.batches[0].status,'waiting');assert.equal(JSON.stringify(scan).includes(sentinel),false)
 await writeFile(chunk,original)
 await f.inbox.approve(scan.batches[0].batchId,scan.batches[0].digest)
 const checked=await f.inbox.scan();assert.equal(checked.batches[0].status,'ready');assert.equal(checked.batches[0].verified.messages,2)
 assert.deepEqual(checked.batches[0].events.slice(-2).map(x=>x.status),['validating','ready'])
 assert.equal((await stat(join(f.inbox.control,'state.json'))).mode&0o777,0o600)
 assert.equal((await readFile(join(f.inbox.control,'state.json'),'utf8')).includes(sentinel),false)
 const restarted=new WorkBuddyInbox(f),again=await restarted.scan();assert.equal(again.batches.length,1);assert.equal(again.batches[0].verified.at,checked.batches[0].verified.at)
})

for(const failure of ['hash','missing','corrupt-image','mime','extra','size','message','limit','permissions'])test(`隔离 ${failure}，保留原件并返回无正文的错误`,async t=>{
 const f=await fixture(t),media=join(f.ready,f.manifest.media[0].path),chunk=join(f.ready,'messages-0001.json')
 if(failure==='hash')await writeFile(chunk,sentinel)
 if(failure==='missing')await rm(media)
 if(failure==='corrupt-image'){await writeFile(media,sentinel);await rewriteManifest(f,m=>{m.media[0].size=Buffer.byteLength(sentinel);m.media[0].sha256=hash(sentinel)});const value=JSON.parse(await readFile(chunk));value.messages[0].mediaRefs[0]={...(JSON.parse(await readFile(join(f.ready,'manifest.json')))).media[0]};const text=JSON.stringify(value);await writeFile(chunk,text);await rewriteManifest(f,m=>{m.chunks[0].sha256=hash(text)})}
 if(failure==='mime'){await rewriteManifest(f,m=>{m.media[0].mime='image/jpeg'});const value=JSON.parse(await readFile(chunk));value.messages[0].mediaRefs[0].mime='image/jpeg';const text=JSON.stringify(value);await writeFile(chunk,text);await rewriteManifest(f,m=>{m.chunks[0].sha256=hash(text)})}
 if(failure==='extra')await writeFile(join(f.ready,'extra.txt'),sentinel,{mode:0o600})
 if(failure==='size')await writeFile(media,Buffer.concat([await readFile(media),Buffer.from('x')]))
 if(failure==='message'){const value=JSON.parse(await readFile(chunk));value.messages[0].sequence=99;const text=JSON.stringify(value);await writeFile(chunk,text);await rewriteManifest(f,m=>{m.chunks[0].sha256=hash(text)})}
 if(failure==='limit')f.inbox=new WorkBuddyInbox({...f,limits:{...INBOX_LIMITS,chunkBytes:100}})
 if(failure==='permissions')await chmod(media,0o644)
 await approve(f)
 const result=await f.inbox.scan(),item=result.batches[0]
 assert.equal(item.status,'failed');assert.ok(item.error.code);assert.equal(JSON.stringify(result).includes(sentinel),false)
 assert.equal((await readdir(join(f.inboxRoot,f.spaceId,'ready'))).length,0)
 assert.ok((await readdir(join(f.inboxRoot,f.spaceId,'quarantine',item.quarantineId))).includes('manifest.json'))
 assert.equal(item.approval,null)
})

test('拒绝损坏清单、总数不符、版本不符、路径穿越与错误空间，发现阶段不读正文',async t=>{
 for(const mutate of [m=>m.format='future',m=>m.totals.messages++,m=>m.spaceId='other-space',m=>m.chunks[0].file='../outside',m=>m.chunks.push(m.chunks[0]),m=>m.secret=sentinel,m=>m.range.from='2026-99-99']){
  const f=await fixture(t);await rewriteManifest(f,mutate);const result=await f.inbox.scan();assert.equal(result.batches[0].status,'failed');assert.equal(result.batches[0].error.code,'INVALID_MANIFEST');assert.equal(JSON.stringify(result).includes(sentinel),false)
 }
 const f=await fixture(t);await writeFile(join(f.ready,'manifest.json'),sentinel);const result=await f.inbox.scan();assert.equal(result.batches[0].error.code,'INVALID_JSON');assert.equal(JSON.stringify(result).includes(sentinel),false)
})

test('清单变化撤销旧批准；修复隔离批次后重试必须重新批准',async t=>{
 const f=await fixture(t),item=await approve(f)
 await rewriteManifest(f,m=>{m.extractorVersion='updated'})
 await assert.rejects(()=>f.inbox.approve(item.batchId,item.digest),{code:'APPROVAL_REQUIRED'})
 const changed=await f.inbox.scan();assert.equal(changed.batches[0].status,'waiting');assert.equal(changed.batches[0].approval,null)
 await approve(f);const chunk=join(f.ready,'messages-0001.json'),good=await readFile(chunk);await writeFile(chunk,'bad')
 const failed=(await f.inbox.scan()).batches[0],isolated=join(f.inboxRoot,f.spaceId,'quarantine',failed.quarantineId)
 await writeFile(join(isolated,'messages-0001.json'),good)
 await f.inbox.retry(failed.batchId);assert.equal((await f.inbox.scan()).batches[0].status,'waiting')
 await approve(f);assert.equal((await f.inbox.scan()).batches[0].status,'ready')
})

test('任意路径配置、祖先软链接、媒体链接与硬链接均拒绝',async t=>{
 const f=await fixture(t)
 await assert.rejects(()=>configureInbox({...f,inboxRoot:projectRoot}),{code:'UNSAFE_PATH'})
 await assert.rejects(()=>configureInbox({...f,inboxRoot:join(projectRoot,'public/inbox')}),{code:'UNSAFE_PATH'})
 await symlink(f.inboxRoot,join(f.root,'alias'))
 await assert.rejects(()=>configureInbox({...f,ownerId:'another',inboxRoot:join(f.root,'alias','child')}),{code:'UNSAFE_PATH'})
 const original=join(f.ready,f.manifest.media[0].path),outside=join(f.root,'outside.png');await rename(original,outside);await symlink(outside,original)
 await approve(f);assert.equal((await f.inbox.scan()).batches[0].status,'failed');assert.ok((await stat(outside)).isFile())
 const g=await fixture(t),path=join(g.ready,g.manifest.media[0].path);await link(path,join(g.root,'hardlink.png'));await approve(g);assert.equal((await g.inbox.scan()).batches[0].error.code,'UNSAFE_FILE')
 const h=await fixture(t);await rename(join(h.ready,'media'),join(h.root,'linked-media'));await symlink(join(h.root,'linked-media'),join(h.ready,'media'));await approve(h);assert.equal((await h.inbox.scan()).batches[0].status,'failed')
})

test('恢复 validating/processing；并发校验被锁住，状态损坏不会被覆盖',async t=>{
 const f=await fixture(t);await approve(f)
 for(const status of ['validating','processing']){const state=await f.inbox.state();state.entries[f.manifest.batchId].status=status;await f.inbox.save(state);assert.equal((await new WorkBuddyInbox(f).scan()).batches[0].status,'ready')}
 const unlock=await f.inbox.lock();try{const blocked=await new WorkBuddyInbox(f).scan();assert.equal(blocked.health.error.code,'BUSY')}finally{await unlock()}
 const statePath=join(f.inbox.control,'state.json');await writeFile(statePath,sentinel);const broken=await f.inbox.scan();assert.equal(broken.ok,false);assert.equal(JSON.stringify(broken).includes(sentinel),false);assert.equal(await readFile(statePath,'utf8'),sentinel)
})

test('watcher 自动发现、批准后校验、暂时不可访问后恢复，停用立即生效',async t=>{
 const f=await fixture(t);let last
 const stop=watchInbox(f.inbox,{intervalMs:25,onResult:value=>{last=value}});t.after(stop)
 await waitUntil(()=>last?.batches[0]?.status==='waiting')
 await f.inbox.approve(last.batches[0].batchId,last.batches[0].digest)
 await waitUntil(()=>last?.batches[0]?.status==='ready')
 await rename(f.inboxRoot,f.inboxRoot+'-offline');await waitUntil(()=>last?.health.status==='unavailable')
 await configureInbox({...f,enabled:false});await waitUntil(()=>last?.health.status==='disabled')
 await rename(f.inboxRoot+'-offline',f.inboxRoot);await configureInbox(f);await waitUntil(()=>last?.batches[0]?.status==='ready')
 stop()
})

test('本机服务监视器无配置时不创建目录，配置后自动发现并隔离失败绑定',async t=>{
 const f=await fixture(t),errors=[]
 const stop=startInboxMonitor({dataRoot:f.dataRoot,projectRoot,intervalMs:25,onError:error=>errors.push(error)});t.after(stop)
 await waitUntil(async()=> (await f.inbox.status()).batches[0]?.status==='waiting');stop()
 const dataRoot=join(f.root,'no-config'),stopEmpty=startInboxMonitor({dataRoot,projectRoot,intervalMs:25,onError:error=>errors.push(error)});await new Promise(resolve=>setTimeout(resolve,60));stopEmpty();await assert.rejects(()=>stat(dataRoot),{code:'ENOENT'})
 assert.equal(JSON.stringify(errors).includes(sentinel),false)
})

test('CLI 需要明确确认，输出仅含状态，数据目录按账号隔离',async t=>{
 const f=await fixture(t),base=['scripts/workbuddy-inbox.mjs'],flags=['--data-root',f.dataRoot,'--owner-id',f.ownerId,'--space-id',f.spaceId]
 const scanned=JSON.parse((await exec(process.execPath,[...base,'scan',...flags])).stdout);assert.equal(scanned.batches[0].status,'waiting')
 await assert.rejects(()=>exec(process.execPath,[...base,'approve',...flags,'--batch-id',f.manifest.batchId,'--digest',scanned.batches[0].digest]),error=>{assert.equal(error.code,2);assert.ok(!error.stdout.includes(sentinel));return true})
 await exec(process.execPath,[...base,'approve',...flags,'--batch-id',f.manifest.batchId,'--digest',scanned.batches[0].digest,'--yes'])
 const result=await exec(process.execPath,[...base,'scan',...flags]);assert.equal(JSON.parse(result.stdout).batches[0].status,'ready');assert.equal(result.stdout.includes(sentinel),false)
 const another=await new WorkBuddyInbox({...f,ownerId:'another-owner'}).status();assert.equal(another.health.status,'not_configured');assert.deepEqual(another.batches,[])
})

test('转换器拒绝项目内输出及源目录软链接，不修改已有宽权限目录',async t=>{
 const f=await fixture(t),options={...f,conversationId:'test-conversation'}
 await assert.rejects(()=>convertLegacyWorkBuddyExport({...options,inboxRoot:join(projectRoot,'public/unsafe')}),{code:'UNSAFE_PATH'})
 const target=join(f.root,'wide');await mkdir(target,{mode:0o755})
 await assert.rejects(()=>convertLegacyWorkBuddyExport({...options,inboxRoot:target}),{code:'PERMISSION_DENIED'});assert.equal((await stat(target)).mode&0o777,0o755)
 await rename(join(f.sourceDir,'images'),join(f.root,'images'));await symlink(join(f.root,'images'),join(f.sourceDir,'images'))
 await assert.rejects(()=>convertLegacyWorkBuddyExport({...options,dryRun:true}),{code:'UNSAFE_PATH'})
})

test('已通过批次被篡改会重新校验；超限或缺失清单隔离',async t=>{
 const f=await fixture(t);await approve(f);assert.equal((await f.inbox.scan()).batches[0].status,'ready')
 await writeFile(join(f.ready,'messages-0001.json'),sentinel)
 assert.equal((await f.inbox.scan()).batches[0].error.code,'HASH_MISMATCH')
 const g=await fixture(t);g.inbox=new WorkBuddyInbox({...g,limits:{...INBOX_LIMITS,manifestBytes:10}});assert.equal((await g.inbox.scan()).batches[0].error.code,'FILE_LIMIT')
 const h=await fixture(t);await rm(join(h.ready,'manifest.json'));assert.equal((await h.inbox.scan()).batches[0].error.code,'MISSING_FILE')
})

test('崩溃留下的进程锁可恢复，校验取消后不产生 ready',async t=>{
 const f=await fixture(t),item=await approve(f)
 const script=`import {WorkBuddyInbox} from './server/lib/workbuddy-inbox.mjs';const inbox=new WorkBuddyInbox(JSON.parse(process.argv[1]));await inbox.load();await inbox.lock();process.exit(0)`
 await exec(process.execPath,['--input-type=module','-e',script,JSON.stringify({dataRoot:f.dataRoot,projectRoot,ownerId:f.ownerId,spaceId:f.spaceId})])
 assert.equal((await f.inbox.scan()).batches[0].status,'ready')
 const controller=new AbortController()
 await assert.rejects(()=>validateBatch(f.ready,{spaceId:f.spaceId,batchId:item.batchId,expectedDigest:item.digest,signal:controller.signal,onProgress:()=>controller.abort()}),{name:'AbortError'})
 const state=await f.inbox.state();state.entries[item.batchId].status='validating';await f.inbox.save(state)
 const cancelled=await f.inbox.scan({signal:controller.signal});assert.equal(cancelled.ok,false)
 assert.equal((await new WorkBuddyInbox(f).scan()).batches[0].status,'ready')
})

test('跨多个分块的校验与消息计数一致',async t=>{
 const f=await fixture(t,{count:2001});assert.equal(f.manifest.chunks.length,3);await approve(f)
 const result=await f.inbox.scan();assert.equal(result.batches[0].verified.messages,2001);assert.equal(result.batches[0].verified.files,5)
})

test('批次 ID 与对象原型同名仍按普通批次处理',async t=>{
 const f=await fixture(t);await rewriteManifest(f,m=>{m.batchId='constructor'})
 await rename(f.ready,join(f.inboxRoot,f.spaceId,'ready','constructor'))
 const found=await f.inbox.scan();assert.equal(found.batches[0].batchId,'constructor');assert.equal(found.batches[0].status,'waiting')
 await f.inbox.approve('constructor',found.batches[0].digest);assert.equal((await f.inbox.scan()).batches[0].status,'ready')
})
