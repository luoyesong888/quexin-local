import {createHash,randomUUID} from 'node:crypto'
import {lstat,opendir,rename,unlink,open} from 'node:fs/promises'
import {join} from 'node:path'
import {absoluteChatPath,assertExternalInbox,atomicPrivateJson,checkedPath,chatId,InboxError,inboxError,parseChatJson,privateDirectory,readChatFile} from '../../shared/workbuddy-chat-files.mjs'
import {batchStamp,inspectBatch,validateBatch,INBOX_LIMITS} from './workbuddy-inbox-validator.mjs'

const STATE_FORMAT='quexin-workbuddy-inbox-state-v1'
const CONFIG_FORMAT='quexin-workbuddy-inbox-config-v1'
const hash=value=>createHash('sha256').update(value).digest('hex')
const states=new Set(['waiting','validating','ready','processing','completed','failed'])
const now=()=>new Date().toISOString()
const optional=async fn=>{try{return await fn()}catch(error){if(error.code==='ENOENT'||error.code==='MISSING_FILE')return null;throw error}}
export const bindingId=(ownerId,spaceId)=>{if(!chatId(ownerId)||!chatId(spaceId))throw new InboxError('UNSAFE_PATH');return hash(ownerId+'\0'+spaceId)}

export async function configureInbox({dataRoot,projectRoot,inboxRoot,ownerId,spaceId,enabled=true}){
 const key=bindingId(ownerId,spaceId),root=assertExternalInbox(inboxRoot,projectRoot),control=join(absoluteChatPath(dataRoot),'workbuddy-inbox',key)
 const config={format:CONFIG_FORMAT,ownerId,spaceId,inboxRoot:root,enabled:Boolean(enabled)}
 await privateDirectory(control)
 const old=await optional(()=>readChatFile(control,'binding.json',4096).then(parseChatJson))
 if(old&&old.inboxRoot!==root)throw new InboxError('BATCH_CONFLICT')
 if(enabled)for(const path of [root,join(root,spaceId),...['staging','ready','processed','quarantine'].map(name=>join(root,spaceId,name))])await privateDirectory(path)
 await atomicPrivateJson(control,'binding.json',config)
 return config
}

export class WorkBuddyInbox {
 constructor({dataRoot,projectRoot,ownerId,spaceId,limits=INBOX_LIMITS}){
  this.ownerId=ownerId;this.spaceId=spaceId;this.projectRoot=projectRoot;this.limits=limits
  this.control=join(absoluteChatPath(dataRoot),'workbuddy-inbox',bindingId(ownerId,spaceId))
  this.config=null;this.health={status:'not_configured'}
 }
 async load(){
  const config=await optional(()=>readChatFile(this.control,'binding.json',4096).then(parseChatJson))
  if(!config)throw new InboxError('NOT_CONFIGURED')
  if(config.format!==CONFIG_FORMAT||config.ownerId!==this.ownerId||config.spaceId!==this.spaceId||typeof config.enabled!=='boolean')throw new InboxError('STATE_INVALID')
  assertExternalInbox(config.inboxRoot,this.projectRoot);this.config=config
  this.spaceRoot=join(config.inboxRoot,this.spaceId)
  return config
 }
 async state(){
  const value=await optional(()=>readChatFile(this.control,'state.json',16*1024*1024).then(parseChatJson))
  if(!value)return{format:STATE_FORMAT,entries:Object.create(null)}
  if(value.format!==STATE_FORMAT||!value.entries||Array.isArray(value.entries)||Object.keys(value.entries).length>2000||!Object.entries(value.entries).every(([id,item])=>chatId(id)&&item?.batchId===id&&states.has(item.status)&&Array.isArray(item.events)&&item.events.length<=12))throw new InboxError('STATE_INVALID')
  return value
 }
 async save(state){await atomicPrivateJson(this.control,'state.json',state)}
 async lock(){
  const file=join(this.control,'operation.lock'),token=randomUUID();let handle
  try{handle=await open(file,'wx',0o600)}catch(error){
   if(error.code!=='EEXIST')throw error
   const before=await lstat(file),owner=await readChatFile(this.control,'operation.lock',1024).then(parseChatJson)
   if(!Number.isSafeInteger(owner.pid)||owner.pid<1)throw new InboxError('BUSY')
   try{process.kill(owner.pid,0);throw new InboxError('BUSY')}catch(cause){if(cause.code!=='ESRCH')throw new InboxError('BUSY')}
   if((await lstat(file)).ino!==before.ino)throw new InboxError('BUSY')
   await unlink(file)
   try{handle=await open(file,'wx',0o600)}catch{throw new InboxError('BUSY')}
  }
  try{await handle.writeFile(JSON.stringify({pid:process.pid,token}));await handle.sync()}finally{await handle.close()}
  return async()=>{const owner=await readChatFile(this.control,'operation.lock',1024).then(parseChatJson);if(owner.token===token)await unlink(file)}
 }
 async exclusive(task){await this.load();const release=await this.lock();try{return await task()}finally{await release()}}
 transition(item,status,error){item.status=status;item.updatedAt=now();item.error=error??null;item.events=[...item.events,{status,at:item.updatedAt}].slice(-12)}
 async checkFolders(){
  await checkedPath(this.config.inboxRoot,{privateMode:true});await checkedPath(this.spaceRoot,{privateMode:true})
  for(const name of ['ready','staging','processed','quarantine'])await checkedPath(join(this.spaceRoot,name),{privateMode:true})
 }
 async quarantine(item,state,error){
  if(item.status!=='failed')this.transition(item,'failed',inboxError(error));item.approval=null
  // Persist intent before rename so a crash can be recovered on the next scan.
  item.quarantineId??=randomUUID();await this.save(state)
  const source=join(this.spaceRoot,'ready',item.batchId),destination=join(this.spaceRoot,'quarantine',item.quarantineId)
  try{
   await this.checkFolders()
   const info=await lstat(source)
   if(!info.isDirectory()||info.isSymbolicLink())return // Do not move/follow a link supplied as a batch.
   if(await optional(()=>lstat(destination)))return
   await rename(source,destination)
  }catch(cause){if(cause.code!=='ENOENT')item.isolationError=inboxError(cause)}
  await this.save(state)
 }
 async scan({signal}={}){
  try{return await this.exclusive(async()=>{
   if(!this.config.enabled){this.health={status:'disabled'};return{ok:true,health:this.health,batches:[]}}
   await this.checkFolders();const state=await this.state();let discovered=0,invalidEntry=false
   for await(const entry of await opendir(join(this.spaceRoot,'ready'))){
    signal?.throwIfAborted();if(++discovered>2000)throw new InboxError('FILE_LIMIT')
    if(!chatId(entry.name)){invalidEntry=true;continue}
    const batchId=entry.name,root=join(this.spaceRoot,'ready',batchId)
    let item=Object.hasOwn(state.entries,batchId)?state.entries[batchId]:null
    if(!item){if(Object.keys(state.entries).length>=2000)throw new InboxError('FILE_LIMIT');item={batchId,status:'waiting',events:[],approval:null};state.entries[batchId]=item;this.transition(item,'waiting')}
    if(item.status==='failed'){await this.quarantine(item,state,new InboxError(item.error?.code));continue}
    try{
     const {manifest,digest}=await inspectBatch(root,{spaceId:this.spaceId,batchId,limits:this.limits})
     if(item.digest!==digest){item.digest=digest;item.approval=null;item.verified=null;this.transition(item,'waiting')}
     item.counts={messages:manifest.totals.messages,media:manifest.totals.media,chunks:manifest.chunks.length}
     await this.save(state)
     if(item.approval?.digest!==digest)continue
     if(item.status==='completed')continue
     if(item.status==='ready'&&item.verified?.stamp===await batchStamp(root,this.limits))continue
     this.transition(item,'validating');await this.save(state)
     const verified=await validateBatch(root,{spaceId:this.spaceId,batchId,expectedDigest:digest,limits:this.limits,signal})
     item.verified={...verified,at:now()};this.transition(item,'ready');await this.save(state)
    }catch(error){
     if(signal?.aborted){this.transition(item,'waiting');await this.save(state);throw error}
     await this.quarantine(item,state,error)
    }
   }
   // A rename may have finished just before the previous process stopped.
   for(const item of Object.values(state.entries))if(item.status==='failed'&&item.quarantineId)await this.quarantine(item,state,new InboxError(item.error?.code))
   const statuses=new Set(Object.values(state.entries).map(item=>item.status))
   this.health={status:invalidEntry||statuses.has('failed')?'attention':'ready',checkedAt:now(),...(invalidEntry?{error:inboxError(new InboxError('UNSAFE_PATH'))}:{})}
   await this.save(state)
   return{ok:true,health:this.health,batches:Object.values(state.entries)}
  })}catch(error){this.health={status:error.code==='NOT_CONFIGURED'?'not_configured':'unavailable',error:inboxError(error)};return{ok:false,health:this.health,batches:[]}}
 }
 async approve(batchId,digest){
  if(!chatId(batchId)||!/^([a-f0-9]{64})$/.test(digest??''))throw new InboxError('APPROVAL_REQUIRED')
  return this.exclusive(async()=>{
   if(!this.config.enabled)throw new InboxError('APPROVAL_REQUIRED')
   await this.checkFolders();const state=await this.state(),item=Object.hasOwn(state.entries,batchId)?state.entries[batchId]:null
   if(!item||item.status==='failed')throw new InboxError('APPROVAL_REQUIRED')
   const inspected=await inspectBatch(join(this.spaceRoot,'ready',batchId),{spaceId:this.spaceId,batchId,limits:this.limits})
   if(inspected.digest!==digest||item.digest!==digest)throw new InboxError('APPROVAL_REQUIRED')
   item.approval={digest,at:now(),ownerId:this.ownerId};this.transition(item,'waiting');await this.save(state)
   return{batchId,status:'waiting',approved:true}
  })
 }
 async retry(batchId){
  if(!chatId(batchId))throw new InboxError('UNSAFE_PATH')
  return this.exclusive(async()=>{
   await this.checkFolders();const state=await this.state(),item=Object.hasOwn(state.entries,batchId)?state.entries[batchId]:null
   if(!item||item.status!=='failed'||!chatId(item.quarantineId))throw new InboxError('APPROVAL_REQUIRED')
   const destination=join(this.spaceRoot,'ready',batchId),source=join(this.spaceRoot,'quarantine',item.quarantineId)
   if(await optional(()=>lstat(destination)))throw new InboxError('BATCH_CONFLICT')
   await checkedPath(source,{privateMode:true});await rename(source,destination)
   // Discovery re-reads the manifest and always requires a new approval.
   delete state.entries[batchId];await this.save(state);return{batchId,status:'waiting'}
  })
 }
 async status(){
  try{await this.load();if(!this.config.enabled)return{ok:true,health:{status:'disabled'},batches:[]};await this.checkFolders();return{ok:true,health:{status:'available'},batches:Object.values((await this.state()).entries)}}catch(error){return{ok:false,health:{status:error.code==='NOT_CONFIGURED'?'not_configured':'unavailable',error:inboxError(error)},batches:[]}}
 }
}

export function watchInbox(inbox,{intervalMs=5000,onResult=()=>{},signal}={}){
 if(!Number.isInteger(intervalMs)||intervalMs<20||intervalMs>60_000)throw new InboxError('UNSAFE_PATH')
 let timer,stopped=false;const controller=new AbortController()
 const run=async()=>{if(stopped)return;try{onResult(await inbox.scan({signal:controller.signal}))}catch{ /* a reporting failure cannot terminate the product */ }finally{if(!stopped)timer=setTimeout(run,intervalMs)}}
 const stop=()=>{stopped=true;clearTimeout(timer);controller.abort();signal?.removeEventListener('abort',stop)}
 signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();else void run()
 return stop
}
