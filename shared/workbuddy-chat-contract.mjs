import {createHash,randomUUID} from 'node:crypto'
import {chmod,lstat,mkdir,rename,rm,writeFile} from 'node:fs/promises'
import {basename,dirname,isAbsolute,join,relative,resolve,sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import {absoluteChatPath,assertExternalInbox,checkedPath,containsPath,InboxError,privateDirectory,readChatFile,safeChatPath,parseChatJson} from './workbuddy-chat-files.mjs'

export const WORKBUDDY_CHAT_FORMAT='quexin-workbuddy-chat-v1'
export const WORKBUDDY_CHAT_LIMITS=Object.freeze({messages:200_000,media:10_000,chunkMessages:1_000,mediaBytes:25*1024*1024,totalBytes:2*1024*1024*1024})
const idPattern=/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const shaPattern=/^[a-f0-9]{64}$/
const imageMarker=/\[图片:([^\]]+)\]/g

const object=value=>typeof value==='object'&&value!==null&&!Array.isArray(value)
const sha256=value=>createHash('sha256').update(value).digest('hex')
const cleanText=value=>String(value??'').replaceAll('\u0000','').trim()
const safeId=(value,label)=>{const text=String(value??'');if(!idPattern.test(text))throw new Error(`${label}不符合协议`);return text}
const safeCount=(value,label)=>{if(!Number.isSafeInteger(value)||value<0)throw new Error(`${label}无效`);return value}
const iso=value=>typeof value==='string'&&!Number.isNaN(Date.parse(value))
const safeRelativePath=value=>{
 const path=String(value??'')
 if(!safeChatPath(path))throw new Error('文件路径越界')
 return path
}
const within=(root,path)=>{const value=relative(root,path);return value===''||!value.startsWith('..'+sep)&&value!=='..'&&!isAbsolute(value)}
const legacyTimestamp=(date,time)=>{
 const raw=cleanText(time)
 if(iso(raw))return new Date(raw).toISOString()
 if(/^\d{2}:\d{2}(?::\d{2})?$/.test(raw)&&/^\d{4}-\d{2}-\d{2}$/.test(date))return `${date}T${raw.length===5?raw+':00':raw}+08:00`
 if(/^\d{4}-\d{2}-\d{2}$/.test(date))return `${date}T12:00:00+08:00`
 throw new Error(`无法识别消息时间：${raw||date}`)
}
const messageHash=input=>sha256([input.conversationId,input.senderId,input.timestamp,String(input.sequence),input.text,...input.mediaRefs.map(item=>item.sha256)].join('\u001f'))
const writePrivate=async(path,content)=>{await privateDirectory(dirname(path));await writeFile(path,content,{mode:0o600,flag:'wx'})}
const mimeFor=name=>({'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.gif':'image/gif','.webp':'image/webp'}[name.slice(name.lastIndexOf('.')).toLowerCase()]??'application/octet-stream')

export function validateWorkBuddyChatManifest(value){
 const errors=[]
 const push=(condition,message)=>{if(!condition)errors.push(message)}
 if(!object(value))return{ok:false,errors:['manifest必须是对象']}
 push(value.format===WORKBUDDY_CHAT_FORMAT,`只支持 ${WORKBUDDY_CHAT_FORMAT}`)
 for(const [key,label] of [['jobId','jobId'],['batchId','batchId'],['spaceId','spaceId'],['conversationId','conversationId']])push(typeof value[key]==='string'&&idPattern.test(value[key]),`${label}无效`)
 push(value.sourceApp==='wechat','sourceApp必须是 wechat')
 push(typeof value.extractorVersion==='string'&&value.extractorVersion.length>0&&value.extractorVersion.length<=80,'extractorVersion无效')
 push(iso(value.createdAt),'createdAt无效')
 push(typeof value.timezone==='string'&&value.timezone.length>0&&value.timezone.length<=80,'timezone无效')
 push(Array.isArray(value.participants)&&value.participants.length>=1&&value.participants.length<=20&&value.participants.every(item=>object(item)&&typeof item.id==='string'&&idPattern.test(item.id)&&typeof item.label==='string'&&item.label.length>0&&item.label.length<=80),'participants无效')
 push(object(value.range)&&/^\d{4}-\d{2}-\d{2}$/.test(value.range.from)&&/^\d{4}-\d{2}-\d{2}$/.test(value.range.to)&&value.range.from<=value.range.to,'range无效')
 push(object(value.totals)&&Number.isSafeInteger(value.totals.messages)&&value.totals.messages>=0&&value.totals.messages<=WORKBUDDY_CHAT_LIMITS.messages&&Number.isSafeInteger(value.totals.media)&&value.totals.media>=0&&value.totals.media<=WORKBUDDY_CHAT_LIMITS.media,'totals无效')
 push(Array.isArray(value.chunks)&&value.chunks.length>0&&value.chunks.every(item=>{try{return object(item)&&Boolean(safeRelativePath(item.file))&&Number.isSafeInteger(item.count)&&item.count>=0&&item.count<=WORKBUDDY_CHAT_LIMITS.chunkMessages&&typeof item.sha256==='string'&&shaPattern.test(item.sha256)}catch{return false}}),'chunks无效')
 push(Array.isArray(value.media)&&value.media.length<=WORKBUDDY_CHAT_LIMITS.media&&value.media.every(item=>{try{return object(item)&&Boolean(safeRelativePath(item.path))&&typeof item.mime==='string'&&item.mime.startsWith('image/')&&Number.isSafeInteger(item.size)&&item.size>=0&&item.size<=WORKBUDDY_CHAT_LIMITS.mediaBytes&&typeof item.sha256==='string'&&shaPattern.test(item.sha256)}catch{return false}}),'media无效')
 push(value.status==='ready','status必须是 ready')
 return{ok:errors.length===0,errors}
}

export function normalizeLegacyChat(value,{conversationId='wechat-conversation',selfLabel,partnerLabel,timezone='Asia/Shanghai',mediaByLegacyPath=new Map()}={}){
 if(!object(value)||!Array.isArray(value.chats))throw new Error('旧版 chat.json 结构无效')
 const self=cleanText(selfLabel??value.self),partner=cleanText(partnerLabel??value.partner)
 if(!self||!partner)throw new Error('缺少双方人物标识')
 if(value.chats.length>3660)throw new Error('聊天日期分组超过上限')
 const messages=[];let sequence=0
 for(const day of value.chats){
  if(!object(day)||!/^\d{4}-\d{2}-\d{2}$/.test(day.date)||!Array.isArray(day.messages))throw new Error('旧版日期分组无效')
  for(const item of day.messages){
   if(!object(item))throw new Error('旧版消息无效')
   sequence+=1;if(sequence>WORKBUDDY_CHAT_LIMITS.messages)throw new Error('消息数量超过上限')
   const senderLabel=cleanText(item.sender),senderId=senderLabel==='我' || senderLabel===self?'self':senderLabel==='对方' || senderLabel===partner?'partner':'participant-'+sha256(senderLabel).slice(0,12),text=String(item.text??''),mediaRefs=[]
   for(const match of text.matchAll(imageMarker)){const legacyPath=safeRelativePath(match[1]),media=mediaByLegacyPath.get(legacyPath);if(!media)throw new Error(`缺少聊天图片：${legacyPath}`);mediaRefs.push({path:media.path,mime:media.mime,size:media.size,sha256:media.sha256})}
   const timestamp=legacyTimestamp(day.date,item.time),normalized={conversationId:safeId(conversationId,'conversationId'),messageId:'',senderId,senderLabel,timestamp,timezone,sequence,text,mediaRefs}
   normalized.messageId=messageHash(normalized)
   messages.push(normalized)
  }
 }
 if(value.total!==undefined&&safeCount(value.total,'total')!==messages.length)throw new Error(`声明消息数 ${value.total} 与实际 ${messages.length} 不一致`)
 return{messages,participants:[{id:'self',label:self},{id:'partner',label:partner}],range:{from:value.range?.[0]??value.chats[0]?.date,to:value.range?.[1]??value.chats.at(-1)?.date}}
}

export async function convertLegacyWorkBuddyExport({sourceDir,inboxRoot,spaceId,conversationId,extractorVersion='workbuddy-legacy-adapter-1',jobId=randomUUID(),batchId,createdAt=new Date().toISOString(),timezone='Asia/Shanghai',dryRun=false}={}){
 if(!sourceDir||!inboxRoot)throw new Error('需要源目录和鹊信交换箱目录')
 const source=absoluteChatPath(resolve(String(sourceDir))),inbox=assertExternalInbox(resolve(String(inboxRoot)),resolve(dirname(fileURLToPath(import.meta.url)),'..'));safeId(spaceId,'spaceId');safeId(conversationId,'conversationId');safeId(jobId,'jobId')
 if(containsPath(source,inbox)||containsPath(inbox,source))throw new InboxError('UNSAFE_PATH')
 await checkedPath(source)
 const legacy=parseChatJson(await readChatFile(source,'chat.json',64*1024*1024,{privateMode:false}))
 if(!Array.isArray(legacy?.chats)||!legacy.chats.every(day=>Array.isArray(day?.messages)))throw new InboxError('INVALID_JSON')
 const referenced=[...new Set(legacy.chats.flatMap(day=>day.messages.flatMap(item=>[...String(item?.text??'').matchAll(imageMarker)].map(match=>match[1]))))];if(referenced.length>WORKBUDDY_CHAT_LIMITS.media)throw new Error('媒体数量超过上限')
 const media=[],mediaByLegacyPath=new Map();let totalBytes=0
 for(const legacyValue of referenced){
  const legacyPath=safeRelativePath(legacyValue),absolute=resolve(source,legacyPath);if(!within(source,absolute))throw new Error(`图片路径越界：${legacyPath}`)
  const buffer=await readChatFile(source,legacyPath,WORKBUDDY_CHAT_LIMITS.mediaBytes,{privateMode:false});totalBytes+=buffer.length;if(totalBytes>WORKBUDDY_CHAT_LIMITS.totalBytes)throw new Error('批次总大小超过上限')
  const targetPath=`media/${sha256(buffer).slice(0,16)}-${basename(legacyPath)}`,record={legacyPath,path:targetPath,mime:mimeFor(legacyPath),size:buffer.length,sha256:sha256(buffer)};if(!media.some(item=>item.path===targetPath))media.push(record);mediaByLegacyPath.set(legacyPath,record)
 }
 const normalized=normalizeLegacyChat(legacy,{conversationId,timezone,mediaByLegacyPath}),chunks=[]
 for(let offset=0;offset<normalized.messages.length;offset+=WORKBUDDY_CHAT_LIMITS.chunkMessages){const messages=normalized.messages.slice(offset,offset+WORKBUDDY_CHAT_LIMITS.chunkMessages),file=`messages-${String(chunks.length+1).padStart(4,'0')}.json`,text=JSON.stringify({messages},null,2)+'\n';chunks.push({file,count:messages.length,sha256:sha256(text),text})}
 const identity=sha256(JSON.stringify({conversationId,range:normalized.range,totals:{messages:normalized.messages.length,media:media.length},chunks:chunks.map(({file,count,sha256})=>({file,count,sha256})),media:media.map(({path,size,sha256})=>({path,size,sha256}))})),resolvedBatch=safeId(batchId??`wb-${identity.slice(0,20)}`,'batchId')
 const manifest={format:WORKBUDDY_CHAT_FORMAT,jobId,batchId:resolvedBatch,spaceId,conversationId,sourceApp:'wechat',extractorVersion,createdAt,timezone,participants:normalized.participants,range:normalized.range,totals:{messages:normalized.messages.length,media:media.length},chunks:chunks.map(({file,count,sha256})=>({file,count,sha256})),media:media.map(({path,mime,size,sha256})=>({path,mime,size,sha256})),status:'ready'}
 const validation=validateWorkBuddyChatManifest(manifest);if(!validation.ok)throw new Error(`manifest 校验失败：${validation.errors.join('；')}`)
 const summary={format:manifest.format,jobId,batchId:resolvedBatch,spaceId,conversationId,range:manifest.range,messages:manifest.totals.messages,media:manifest.totals.media,chunks:manifest.chunks.length,dryRun:Boolean(dryRun)}
 if(dryRun)return{manifest,summary}
 const spaceRoot=join(inbox,spaceId),staging=join(spaceRoot,'staging',jobId),readyParent=join(spaceRoot,'ready'),ready=join(readyParent,resolvedBatch)
 if(!within(inbox,spaceRoot)||!within(spaceRoot,staging)||!within(spaceRoot,ready))throw new Error('交换箱路径越界')
 for(const path of [inbox,spaceRoot,join(spaceRoot,'staging'),readyParent,join(spaceRoot,'processed'),join(spaceRoot,'quarantine')])await privateDirectory(path)
 try{await lstat(ready);throw new Error('EEXIST: 目标批次已经存在')}catch(error){if(error.code!=='ENOENT')throw error}
 let stagingCreated=false
 try{
  await mkdir(staging,{mode:0o700});stagingCreated=true;await chmod(staging,0o700)
  for(const chunk of chunks)await writePrivate(join(staging,chunk.file),chunk.text)
  for(const item of media){const bytes=await readChatFile(source,item.legacyPath,WORKBUDDY_CHAT_LIMITS.mediaBytes,{privateMode:false});if(sha256(bytes)!==item.sha256)throw new InboxError('FILE_CHANGED');await writePrivate(join(staging,item.path),bytes)}
  await writePrivate(join(staging,'manifest.json'),JSON.stringify(manifest,null,2)+'\n')
  await rename(staging,ready);await chmod(ready,0o700)
 }catch(error){if(stagingCreated)await rm(staging,{recursive:true,force:true});throw error}
 return{manifest,summary:{...summary,ready}}
}
