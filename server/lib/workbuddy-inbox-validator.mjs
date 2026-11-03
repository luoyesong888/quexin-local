import {createHash} from 'node:crypto'
import {opendir} from 'node:fs/promises'
import {join} from 'node:path'
import sharp from 'sharp'
import {validateWorkBuddyChatManifest,WORKBUDDY_CHAT_LIMITS} from '../../shared/workbuddy-chat-contract.mjs'
import {checkedPath,readChatFile,parseChatJson,safeChatPath,chatId,InboxError} from '../../shared/workbuddy-chat-files.mjs'

export const INBOX_LIMITS=Object.freeze({...WORKBUDDY_CHAT_LIMITS,manifestBytes:4*1024*1024,chunkBytes:16*1024*1024,files:10201,chunks:200,depth:4,pixels:40_000_000})
export const hashBytes=bytes=>createHash('sha256').update(bytes).digest('hex')
const exact=(object,keys)=>object&&typeof object==='object'&&!Array.isArray(object)&&Object.keys(object).length===keys.length&&keys.every(key=>Object.hasOwn(object,key))
const day=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value
const zone=value=>{try{return typeof value==='string'&&Boolean(new Intl.DateTimeFormat('en',{timeZone:value}))}catch{return false}}
const time=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(value)&&Number.isFinite(Date.parse(value))&&day(value.slice(0,10))
const mediaTypes={'image/jpeg':'jpeg','image/png':'png','image/gif':'gif','image/webp':'webp'}

export function checkManifest(manifest,{spaceId,batchId,limits=INBOX_LIMITS}){
 let valid=false
 try{
  valid=validateWorkBuddyChatManifest(manifest).ok&&exact(manifest,['format','jobId','batchId','spaceId','conversationId','sourceApp','extractorVersion','createdAt','timezone','participants','range','totals','chunks','media','status'])&&manifest.spaceId===spaceId&&manifest.batchId===batchId&&time(manifest.createdAt)&&zone(manifest.timezone)&&day(manifest.range.from)&&day(manifest.range.to)&&exact(manifest.range,['from','to'])&&exact(manifest.totals,['messages','media'])&&manifest.chunks.length<=limits.chunks&&manifest.totals.messages<=limits.messages&&manifest.totals.media<=limits.media
  if(!valid)throw new InboxError('INVALID_MANIFEST')
  const paths=new Set(['manifest.json']),senders=new Set()
  for(const participant of manifest.participants){if(!exact(participant,['id','label'])||senders.has(participant.id))throw new InboxError('INVALID_MANIFEST');senders.add(participant.id)}
  let count=0,bytes=0
  for(const chunk of manifest.chunks){if(!exact(chunk,['file','count','sha256'])||!/^messages-\d{4}\.json$/.test(chunk.file)||paths.has(chunk.file))throw new InboxError('INVALID_MANIFEST');paths.add(chunk.file);count+=chunk.count}
  for(const media of manifest.media){if(!exact(media,['path','mime','size','sha256'])||!safeChatPath(media.path)||!media.path.startsWith('media/')||paths.has(media.path)||!mediaTypes[media.mime]||media.size>limits.mediaBytes)throw new InboxError('INVALID_MANIFEST');paths.add(media.path);bytes+=media.size}
  if(count!==manifest.totals.messages||manifest.media.length!==manifest.totals.media||bytes>limits.totalBytes||paths.size>limits.files)throw new InboxError('INVALID_MANIFEST')
  return manifest
 }catch(error){if(error instanceof InboxError)throw error;throw new InboxError('INVALID_MANIFEST')}
}

// Discovery reads this bounded manifest only. Chunk/image bytes require approval.
export async function inspectBatch(root,{spaceId,batchId,limits=INBOX_LIMITS}){
 if(!chatId(spaceId)||!chatId(batchId))throw new InboxError('UNSAFE_PATH')
 const bytes=await readChatFile(root,'manifest.json',limits.manifestBytes)
 const manifest=checkManifest(parseChatJson(bytes),{spaceId,batchId,limits})
 return{manifest,digest:hashBytes(bytes)}
}

async function inventory(root,limits){
 const files=new Set(),stamps=[];let bytes=0,entries=0
 async function walk(prefix='',depth=0){
  if(depth>limits.depth)throw new InboxError('FILE_LIMIT')
  const folder=join(root,prefix);await checkedPath(folder,{privateMode:true})
  for await(const entry of await opendir(folder)){
   if(++entries>limits.files+limits.media+2)throw new InboxError('FILE_LIMIT')
   const path=prefix?prefix+'/'+entry.name:entry.name;if(!safeChatPath(path))throw new InboxError('UNSAFE_PATH')
   if(entry.isDirectory()){await walk(path,depth+1);continue}
   const info=await checkedPath(join(root,path),{kind:'file',privateMode:true})
   if(files.size>=limits.files||info.size>(path==='manifest.json'?limits.manifestBytes:path.startsWith('media/')?limits.mediaBytes:limits.chunkBytes))throw new InboxError('FILE_LIMIT',path)
   bytes+=info.size;if(bytes>limits.totalBytes)throw new InboxError('FILE_LIMIT')
   stamps.push([path,info.size,info.dev,info.ino,info.mtimeMs,info.ctimeMs])
   files.add(path)
  }
 }
 await walk();return{files,bytes,stamp:hashBytes(JSON.stringify(stamps.sort((a,b)=>a[0].localeCompare(b[0]))))}
}

export const batchStamp=async(root,limits=INBOX_LIMITS)=>(await inventory(root,limits)).stamp

function checkMessage(message,manifest,sequence,media){
 if(!exact(message,['conversationId','messageId','senderId','senderLabel','timestamp','timezone','sequence','text','mediaRefs'])||message.conversationId!==manifest.conversationId||!chatId(message.messageId)||!manifest.participants.some(p=>p.id===message.senderId)||typeof message.senderLabel!=='string'||!message.senderLabel||message.senderLabel.length>80||!time(message.timestamp)||message.timezone!==manifest.timezone||message.sequence!==sequence||typeof message.text!=='string'||message.text.length>100_000||!Array.isArray(message.mediaRefs)||message.mediaRefs.length>100)throw new InboxError('INVALID_MESSAGE')
 for(const ref of message.mediaRefs){const expected=media.get(ref?.path);if(!expected||!exact(ref,['path','mime','size','sha256'])||ref.sha256!==expected.sha256||ref.size!==expected.size||ref.mime!==expected.mime)throw new InboxError('INVALID_MESSAGE')}
}

export async function validateBatch(root,{spaceId,batchId,expectedDigest,limits=INBOX_LIMITS,signal,onProgress=()=>{}}){
 signal?.throwIfAborted()
 const {manifest,digest}=await inspectBatch(root,{spaceId,batchId,limits})
 if(digest!==expectedDigest)throw new InboxError('APPROVAL_REQUIRED')
 const listing=await inventory(root,limits),expected=new Set(['manifest.json',...manifest.chunks.map(c=>c.file),...manifest.media.map(m=>m.path)])
 for(const path of expected)if(!listing.files.has(path))throw new InboxError('MISSING_FILE',path)
 for(const path of listing.files)if(!expected.has(path))throw new InboxError('UNEXPECTED_FILE',path)
 const media=new Map(manifest.media.map(item=>[item.path,item]));let count=0,checked=0
 for(const chunk of manifest.chunks){
  signal?.throwIfAborted();const bytes=await readChatFile(root,chunk.file,limits.chunkBytes)
  if(hashBytes(bytes)!==chunk.sha256)throw new InboxError('HASH_MISMATCH',chunk.file)
  const value=parseChatJson(bytes)
  if(!exact(value,['messages'])||!Array.isArray(value.messages)||value.messages.length!==chunk.count)throw new InboxError('INVALID_MESSAGE')
  for(const message of value.messages)checkMessage(message,manifest,++count,media)
  onProgress({checkedFiles:++checked,totalFiles:expected.size-1})
 }
 for(const item of manifest.media){
  signal?.throwIfAborted();const bytes=await readChatFile(root,item.path,limits.mediaBytes)
  if(bytes.length!==item.size)throw new InboxError('SIZE_MISMATCH',item.path)
  if(hashBytes(bytes)!==item.sha256)throw new InboxError('HASH_MISMATCH',item.path)
  try{const image=sharp(bytes,{limitInputPixels:limits.pixels,failOn:'warning'}),metadata=await image.metadata();if(metadata.format!==mediaTypes[item.mime])throw new Error();await image.stats()}catch{throw new InboxError('MEDIA_INVALID',item.path)}
  onProgress({checkedFiles:++checked,totalFiles:expected.size-1})
 }
 if(count!==manifest.totals.messages)throw new InboxError('INVALID_MESSAGE')
 if((await inspectBatch(root,{spaceId,batchId,limits})).digest!==digest)throw new InboxError('FILE_CHANGED')
 if(await batchStamp(root,limits)!==listing.stamp)throw new InboxError('FILE_CHANGED')
 return{digest,messages:count,media:manifest.totals.media,files:listing.files.size,bytes:listing.bytes,stamp:listing.stamp}
}
