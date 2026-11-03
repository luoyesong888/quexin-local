import {randomUUID} from 'node:crypto'
import {z} from 'zod'
import {WorkBuddyInbox,configureInbox} from './workbuddy-inbox.mjs'
import {InboxError,inboxError} from '../../shared/workbuddy-chat-files.mjs'
import {digestText} from '../../shared/workbuddy-chat-identity.mjs'

export class WorkBuddyChatError extends Error {
 constructor(code,message,status=400){super(message);this.code=code;this.status=status}
}
const fail=(code,message,status=400)=>{throw new WorkBuddyChatError(code,message,status)}
const id=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/)
const ref=z.object({conversationId:id,messageId:id}).strict()
const base={expectedOwnerId:id,expectedSpaceId:id}
const schemas={
 status:z.object({expectedOwnerId:id}).strict(),
 progress:z.object(base).strict(),
 connect:z.object({...base,inboxRoot:z.string().min(1).max(1000),currentPassword:z.string().min(1).max(128),consent:z.literal(true)}).strict(),
 receive:z.object({...base,batchId:id,digest:z.string().regex(/^[a-f0-9]{64}$/),consent:z.literal(true)}).strict(),
 retry:z.object({...base,batchId:id}).strict(),
 search:z.object({...base,conversationId:id,query:z.string().max(200).default(''),from:z.string().max(10).default(''),to:z.string().max(10).default(''),senderId:z.string().max(128).default(''),cursor:z.string().max(2000).default('')}).strict(),
 message:z.object({...base,...ref.shape}).strict(),
 preview:z.object({...base,refs:z.array(ref).min(1).max(6)}).strict(),
 organize:z.object({...base,previewId:z.string().uuid(),digest:z.string().regex(/^[a-f0-9]{64}$/),mode:z.enum(['local','model']),consent:z.literal(true)}).strict(),
}
const publicBatch=item=>({batchId:item.batchId,digest:item.digest,status:item.status,counts:item.counts,summary:item.summary,
 error:item.error?{code:item.error.code,message:item.error.message}:null,
 receipt:item.archive?{added:item.archive.added,duplicates:item.archive.duplicates,totalMessages:item.archive.totalMessages}:null})

// All identity comes from the authenticated session. Scope is resolved again on
// every request; another member of the same couple never inherits this archive.
export class WorkBuddyChatService {
 constructor({dataRoot,projectRoot,store,provider,verifyPassword,clock=Date.now}){
  Object.assign(this,{dataRoot,projectRoot,store,provider,verifyPassword,clock})
  this.previews=new Map()
  this.active=new Map()
 }
 async run(action,input,user,{signal}={}){
  const parsed=schemas[action]?.safeParse(input)
  if(!parsed?.success)fail('VALIDATION_FAILED','聊天资料请求格式无效。')
  const body=parsed.data
  if(body.expectedOwnerId!==user.id)fail('ACCOUNT_CHANGED','登录账号已经变化，请刷新后重试。',409)
  const current=await this.store.currentSpace(user.id),spaceId=current?.space.id??'personal'
  if(action!=='status'&&body.expectedSpaceId!==spaceId)fail('SCOPE_CHANGED','资料空间已经变化，请重新检查交换箱。',409)
  const scope={ownerId:user.id,spaceId},inbox=new WorkBuddyInbox({...this,...scope})
  const key=[user.id,spaceId,user.tokenHash].join(':')
  for(const [token,preview] of this.previews)if(preview.expiresAt<=this.clock())this.previews.delete(token)
  try{
   if(action==='status'){
    let result=await inbox.scan({manifestOnly:true,signal})
    if(result.health.error?.code==='BUSY')result=await inbox.status()
    let stats={messages:0,batches:0,conversations:[]}
    if(result.ok&&result.health.status!=='disabled')stats=await inbox.queryArchive('stats',{}, {signal})
    return{scope,health:result.health,batches:result.batches.map(publicBatch),stats,model:this.provider.publicConfig()}
   }
   if(action==='connect'){
    if(!await this.verifyPassword(body.currentPassword,user.passwordHash))fail('INVALID_CREDENTIALS','当前账号密码不正确。',401)
    await configureInbox({...this,...scope,inboxRoot:body.inboxRoot})
    return{connected:true,scope}
   }
   if(action==='progress')return this.active.get(key)??null
   if(action==='receive'){
    if(this.active.has(key))fail('BUSY','当前聊天归档正在处理中，请稍后重试。',409)
    this.active.set(key,{batchId:body.batchId,messages:0,total:0})
    try{return await inbox.receive(body.batchId,body.digest,{signal,onProgress:counts=>this.active.set(key,{batchId:body.batchId,...counts})})}
    finally{this.active.delete(key)}
   }
   if(action==='retry')return await inbox.retry(body.batchId)
   if(action==='search')return await inbox.queryArchive('search',{conversationId:body.conversationId,query:body.query,from:body.from,to:body.to,senderId:body.senderId,cursor:body.cursor,limit:20},{signal})
   if(action==='message')return await inbox.queryArchive('message',{conversationId:body.conversationId,messageId:body.messageId},{signal})
   if(action==='preview'){
    const config=this.provider.publicConfig(),limit=Math.min(6,config.maxSources??6)
    if(body.refs.length>limit)fail('SOURCE_LIMIT',`本次最多选择 ${limit} 条聊天片段。`)
    if(new Set(body.refs.map(row=>`${row.conversationId}/${row.messageId}`)).size!==body.refs.length)fail('VALIDATION_FAILED','请勿重复选择同一条消息。')
    const excerpts=[]
    for(const reference of body.refs){
     const message=await inbox.queryArchive('message',reference,{signal}),source=message.sources[0]
     const text=message.text.slice(0,Math.min(1000,config.maxSourceChars??1000))
     if(!text.trim()||!source)continue
     excerpts.push({...reference,senderLabel:message.senderLabel,timestamp:message.timestamp,date:message.date,text,truncated:text.length<message.text.length,
      source:{batchId:source.batchId,sequence:source.sequence,chunkFile:source.chunkFile,chunkLine:source.chunkLine,manifestDigest:source.manifestDigest,extractorVersion:source.extractorVersion}})
    }
    if(!excerpts.length)fail('EMPTY_SELECTION','这些消息没有可整理的文字，请重新选择。')
    const payload={consent:true,baseDate:new Date().toISOString().slice(0,10),selfName:'发送者',partnerName:'联系人',lines:excerpts.map((row,index)=>({line:index+1,text:`${row.timestamp} ${row.senderLabel}：${row.text}`}))}
    const digest=digestText(JSON.stringify(payload)),previewId=randomUUID(),expiresAt=this.clock()+5*60_000
    // Keep only the latest preview for this login; no disk, logs, or audit body.
    for(const [token,item] of this.previews)if(item.key===key)this.previews.delete(token)
    if(this.previews.size>=1000)fail('BUSY','整理请求较多，请稍后重试。',429)
    this.previews.set(previewId,{key,digest,payload,excerpts,expiresAt,model:JSON.stringify(config)})
    return{previewId,digest,excerpts,lines:payload.lines,expiresAt,model:config}
   }
   if(action==='organize'){
    const preview=this.previews.get(body.previewId)
    if(!preview||preview.key!==key||preview.digest!==body.digest)fail('PREVIEW_EXPIRED','资料确认已失效，请重新选择片段。',409)
    if(preview.model!==JSON.stringify(this.provider.publicConfig()))fail('PREVIEW_EXPIRED','模型配置已变化，请重新确认发送范围。',409)
    await inbox.load()
    if(!inbox.config.enabled)fail('APPROVAL_REQUIRED','资料文件夹已停用，请重新连接。',409)
    this.previews.delete(body.previewId) // One-use approval, including failed calls.
    let candidates
    if(body.mode==='model'){
     try{candidates=(await this.provider.run('candidates',preview.payload,{signal})).candidates}
     catch{fail('MODEL_FAILED',signal?.aborted?'本次整理已取消。':'模型整理失败，未保存任何候选。可重新选择片段并使用本地整理。',502)}
    }else candidates=preview.excerpts.map((row,index)=>({title:row.text.slice(0,40),body:row.text,kind:/喜欢|不吃|不喜欢|讨厌/.test(row.text)?'偏好':/想去|想要|希望/.test(row.text)?'心愿':/提醒|下周|明天|计划|预约/.test(row.text)?'计划':'回忆',date:'',sourceLine:index+1}))
    return{mode:body.mode,candidates:candidates.map(item=>{
     const excerpt=preview.excerpts[item.sourceLine-1]
     if(!excerpt)fail('INVALID_CITATION','整理结果引用无效，未保存任何候选。',502)
     return{id:randomUUID(),title:item.title,body:item.body,kind:item.kind,date:item.date,sensitive:true,excerpt}
    })}
   }
  }catch(error){
   if(error instanceof WorkBuddyChatError)throw error
   if(error instanceof InboxError){const safe=inboxError(error);throw new WorkBuddyChatError(safe.code,safe.message,['BUSY','APPROVAL_REQUIRED','ARCHIVE_APPROVAL_REQUIRED'].includes(safe.code)?409:400)}
   fail(signal?.aborted?'CANCELLED':'WORKBUDDY_UNAVAILABLE',signal?.aborted?'任务已停止，请检查归档状态。':'本机聊天资料暂时不可用，请检查文件夹后重试。',503)
  }
 }
}
