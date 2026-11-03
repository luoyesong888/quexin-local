import {parentPort,workerData} from 'node:worker_threads'
import {DatabaseSync} from 'node:sqlite'
import {lstat,open} from 'node:fs/promises'
import {join} from 'node:path'
import {absoluteChatPath,assertExternalInbox,containsPath,checkedPath,privateDirectory,readChatFile,parseChatJson,InboxError,chatId} from '../../shared/workbuddy-chat-files.mjs'
import {digestText,chatContentHash,archiveMessageId,WORKBUDDY_CHAT_SOURCE_TYPE} from '../../shared/workbuddy-chat-identity.mjs'
import {inspectBatch,validateBatch,INBOX_LIMITS,hashBytes} from './workbuddy-inbox-validator.mjs'

const {options,action,payload}=workerData
const root=join(absoluteChatPath(options.dataRoot),'workbuddy-archive',digestText(options.ownerId+'\0'+options.spaceId)),path=join(root,'chat.sqlite')
const now=()=>new Date().toISOString()
const missing=error=>error.code==='ENOENT'
const maxMessages=1_000_000,maxSources=2_000_000,maxTextBytes=512*1024*1024
let db
async function database(write=false){
 if(!chatId(options.ownerId)||!chatId(options.spaceId))throw new InboxError('UNSAFE_PATH')
 const data=absoluteChatPath(options.dataRoot),project=absoluteChatPath(options.projectRoot)
 if(!containsPath(join(project,'.local-data'),data))assertExternalInbox(data,project)
 try{await checkedPath(root,{privateMode:true})}catch(error){if(!write||!missing(error)){if(missing(error))return false;throw error}await privateDirectory(root)}
 let created=false
 try{await checkedPath(path,{kind:'file',privateMode:true})}catch(error){if(!missing(error))throw error;if(!write)return false;const handle=await open(path,'wx',0o600);await handle.close();created=true}
 let recovery=false
 for(const suffix of ['-journal','-wal','-shm'])try{const info=await checkedPath(path+suffix,{kind:'file',privateMode:true});if(info.size>0)recovery=true}catch(error){if(!missing(error))throw error}
 if((await lstat(path)).size>2*1024**3)throw new InboxError('FILE_LIMIT')
 db=new DatabaseSync(path,{readOnly:!write&&!recovery,enableForeignKeyConstraints:true,enableDoubleQuotedStringLiterals:false})
 db.exec('PRAGMA busy_timeout=5000; PRAGMA trusted_schema=OFF;')
 if(write){
  db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;')
  if(created||(db.prepare('PRAGMA user_version').get().user_version===0&&db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").get().count===0)){
   db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
    CREATE TABLE batches (batch_id TEXT PRIMARY KEY, digest TEXT NOT NULL, conversation_id TEXT NOT NULL, imported_at TEXT NOT NULL, counts_json TEXT NOT NULL) STRICT;
    CREATE TABLE conversations (conversation_id TEXT PRIMARY KEY, timezone TEXT NOT NULL, first_ms REAL, watermark_ms REAL, message_count INTEGER NOT NULL DEFAULT 0) STRICT;
    CREATE TABLE messages (row_id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL, message_id TEXT NOT NULL, content_hash TEXT NOT NULL, sender_id TEXT NOT NULL, sender_label TEXT NOT NULL, timestamp TEXT NOT NULL, timestamp_ms REAL NOT NULL, local_date TEXT NOT NULL, timezone TEXT NOT NULL, text TEXT NOT NULL, media_json TEXT NOT NULL, origin_batch TEXT NOT NULL, origin_sequence INTEGER NOT NULL, UNIQUE(conversation_id,message_id)) STRICT;
    CREATE INDEX message_time ON messages(conversation_id,timestamp_ms,row_id);
    CREATE INDEX message_date ON messages(conversation_id,local_date,timestamp_ms,row_id);
    CREATE INDEX message_sender ON messages(conversation_id,sender_id,timestamp_ms,row_id);
    CREATE TABLE sources (batch_id TEXT NOT NULL REFERENCES batches(batch_id), sequence INTEGER NOT NULL, conversation_id TEXT NOT NULL, message_id TEXT NOT NULL, source_message_id TEXT NOT NULL, chunk_file TEXT NOT NULL, chunk_line INTEGER NOT NULL, extractor_version TEXT NOT NULL, media_json TEXT NOT NULL, PRIMARY KEY(batch_id,sequence), FOREIGN KEY(conversation_id,message_id) REFERENCES messages(conversation_id,message_id)) STRICT;
    CREATE INDEX source_message ON sources(conversation_id,message_id,batch_id);
    PRAGMA user_version=1;`)
   const insert=db.prepare('INSERT INTO meta VALUES (?,?)');insert.run('ownerId',options.ownerId);insert.run('spaceId',options.spaceId);insert.run('textBytes','0');db.exec('COMMIT')
  }
 }
 if(db.prepare('PRAGMA user_version').get().user_version!==1||db.prepare('SELECT value FROM meta WHERE key=?').get('ownerId')?.value!==options.ownerId||db.prepare('SELECT value FROM meta WHERE key=?').get('spaceId')?.value!==options.spaceId)throw new InboxError('STATE_INVALID')
 if(!write)db.exec('PRAGMA query_only=ON')
 return true
}
function existingReceipt(batchId,digest){
 const row=db.prepare('SELECT * FROM batches WHERE batch_id=?').get(batchId)
 if(!row)return null
 if(row.digest!==digest)throw new InboxError('BATCH_CONFLICT')
 return{...JSON.parse(row.counts_json),batchId,digest,importedAt:row.imported_at,replayed:true}
}
function localDate(timestamp,formatter){const parts=formatter.formatToParts(new Date(timestamp));const part=type=>parts.find(item=>item.type===type).value;return`${part('year')}-${part('month')}-${part('day')}`}

async function importBatch(){
 const {batchId,digest,root:batchRoot}=payload
 if(!chatId(batchId)||!/^([a-f0-9]{64})$/.test(digest??''))throw new InboxError('APPROVAL_REQUIRED')
 await database(true)
 const previous=existingReceipt(batchId,digest);if(previous)return previous
 // Revalidate at consumption time, even if F2 previously marked the batch ready.
 const verified=await validateBatch(batchRoot,{spaceId:options.spaceId,batchId,expectedDigest:digest})
 const {manifest}=await inspectBatch(batchRoot,{spaceId:options.spaceId,batchId})
 const occurrences=new Map(),dateFormat=new Intl.DateTimeFormat('en-CA',{timeZone:manifest.timezone,year:'numeric',month:'2-digit',day:'2-digit'});let added=0,duplicates=0,read=0,fallbackIdentities=0
 const total=db.prepare('SELECT COUNT(*) AS count FROM messages').get().count
 if(db.prepare('SELECT COUNT(*) AS count FROM sources').get().count+manifest.totals.messages>maxSources)throw new InboxError('FILE_LIMIT')
 let textBytes=Number(db.prepare("SELECT value FROM meta WHERE key='textBytes'").get().value)
 const previousConversation=db.prepare('SELECT * FROM conversations WHERE conversation_id=?').get(manifest.conversationId)
 if(previousConversation&&previousConversation.timezone!==manifest.timezone)throw new InboxError('BATCH_CONFLICT')
 let first=previousConversation?.first_ms??Infinity,watermark=previousConversation?.watermark_ms??-Infinity
 db.exec('BEGIN IMMEDIATE')
 try{
  db.prepare('INSERT INTO batches VALUES (?,?,?,?,?)').run(batchId,digest,manifest.conversationId,now(),'{}')
  db.prepare('INSERT OR IGNORE INTO conversations (conversation_id,timezone) VALUES (?,?)').run(manifest.conversationId,manifest.timezone)
  const find=db.prepare('SELECT content_hash FROM messages WHERE conversation_id=? AND message_id=?')
  const insert=db.prepare('INSERT INTO messages (conversation_id,message_id,content_hash,sender_id,sender_label,timestamp,timestamp_ms,local_date,timezone,text,media_json,origin_batch,origin_sequence) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
  const source=db.prepare('INSERT INTO sources VALUES (?,?,?,?,?,?,?,?,?)')
  for(const chunk of manifest.chunks){
   const bytes=await readChatFile(batchRoot,chunk.file,INBOX_LIMITS.chunkBytes)
   if(hashBytes(bytes)!==chunk.sha256)throw new InboxError('HASH_MISMATCH')
   const messages=parseChatJson(bytes).messages
   for(let i=0;i<messages.length;i++){
    const message=messages[i],id=archiveMessageId(message,manifest.extractorVersion,occurrences),contentHash=chatContentHash(message),found=find.get(manifest.conversationId,id)
    if(id.startsWith('fallback-'))fallbackIdentities++
    textBytes+=Buffer.byteLength(JSON.stringify(message.mediaRefs))*2+Buffer.byteLength(message.text)+512
    if(textBytes>maxTextBytes)throw new InboxError('FILE_LIMIT')
    if(found){if(found.content_hash!==contentHash)throw new InboxError('MESSAGE_CONFLICT');duplicates++}
    else{
     if(total+added+1>maxMessages)throw new InboxError('FILE_LIMIT')
     const timestamp=new Date(message.timestamp).toISOString(),ms=Date.parse(timestamp)
     insert.run(manifest.conversationId,id,contentHash,message.senderId,message.senderLabel,timestamp,ms,localDate(timestamp,dateFormat),manifest.timezone,message.text,JSON.stringify(message.mediaRefs),batchId,message.sequence)
     added++;first=Math.min(first,ms);watermark=Math.max(watermark,ms)
    }
    source.run(batchId,message.sequence,manifest.conversationId,id,message.messageId,chunk.file,i+1,manifest.extractorVersion,JSON.stringify(message.mediaRefs));read++
   }
   parentPort.postMessage({type:'progress',value:{messages:read,total:manifest.totals.messages}})
  }
  // Full second validation catches a changed attachment before committing anything.
  const final=await validateBatch(batchRoot,{spaceId:options.spaceId,batchId,expectedDigest:digest})
  if(final.stamp!==verified.stamp)throw new InboxError('FILE_CHANGED')
  const result={batchId,digest,conversationId:manifest.conversationId,added,duplicates,fallbackIdentities,totalMessages:(previousConversation?.message_count??0)+added,watermark:Number.isFinite(watermark)?new Date(watermark).toISOString():null,importedAt:now(),replayed:false}
  db.prepare('UPDATE conversations SET first_ms=?,watermark_ms=?,message_count=message_count+? WHERE conversation_id=?').run(Number.isFinite(first)?first:null,Number.isFinite(watermark)?watermark:null,added,manifest.conversationId)
  db.prepare("UPDATE meta SET value=? WHERE key='textBytes'").run(String(textBytes))
  db.prepare('UPDATE batches SET counts_json=?,imported_at=? WHERE batch_id=?').run(JSON.stringify(result),result.importedAt,batchId)
  db.exec('COMMIT');return result
 }catch(error){try{db.exec('ROLLBACK')}catch{}throw error}
}

const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value
function queryOptions(){
 const {conversationId,query='',senderId='',from='',to='',limit=30,cursor=''}=payload
 if(!chatId(conversationId)||typeof query!=='string'||query.length>200||typeof senderId!=='string'||senderId&&!chatId(senderId)||from&&!validDate(from)||to&&!validDate(to)||from&&to&&from>to||!Number.isInteger(limit)||limit<1||limit>100||typeof cursor!=='string'||cursor.length>2048)throw new InboxError('INVALID_QUERY')
 return{conversationId,query,senderId,from,to,limit,cursor}
}
function provenance(row){return{type:WORKBUDDY_CHAT_SOURCE_TYPE,batchId:row.origin_batch,conversationId:row.conversation_id,messageId:row.message_id,sequence:row.origin_sequence}}
function excerpt(text,query){let index=query?text.toLowerCase().indexOf(query.toLowerCase()):0;index=Math.max(0,index-80);return{snippet:text.slice(index,index+500),truncated:index>0||text.length>index+500}}
function search(){
 const filter=queryOptions(),{conversationId,query,senderId,from,to,limit}=filter
 const signature=digestText(JSON.stringify([options.ownerId,options.spaceId,conversationId,query,senderId,from,to]))
 let cursor=null
 if(filter.cursor){try{cursor=JSON.parse(Buffer.from(filter.cursor,'base64url').toString('utf8'))}catch{throw new InboxError('INVALID_QUERY')}
  if(!cursor||typeof cursor!=='object'||cursor.signature!==signature||!Number.isSafeInteger(cursor.row)||cursor.row<1||!Number.isSafeInteger(cursor.snapshot)||cursor.snapshot<cursor.row||!Number.isFinite(cursor.ms))throw new InboxError('INVALID_QUERY')}
 const snapshot=cursor?.snapshot??db.prepare('SELECT COALESCE(MAX(row_id),0) AS maximum FROM messages WHERE conversation_id=?').get(conversationId).maximum
 const where=['conversation_id=?','row_id<=?'],params=[conversationId,snapshot]
 if(query){where.push('instr(lower(text),lower(?))>0');params.push(query)}
 if(senderId){where.push('sender_id=?');params.push(senderId)}
 if(from){where.push('local_date>=?');params.push(from)}
 if(to){where.push('local_date<=?');params.push(to)}
 if(cursor){where.push('(timestamp_ms>? OR (timestamp_ms=? AND row_id>?))');params.push(cursor.ms,cursor.ms,cursor.row)}
 const rows=db.prepare(`SELECT row_id,conversation_id,message_id,sender_id,sender_label,timestamp,timestamp_ms,local_date,text,origin_batch,origin_sequence,json_array_length(media_json) AS media_count FROM messages WHERE ${where.join(' AND ')} ORDER BY timestamp_ms,row_id LIMIT ?`).all(...params,limit+1)
 const items=rows.slice(0,limit),last=items.at(-1)
 return{items:items.map(row=>({messageId:row.message_id,conversationId:row.conversation_id,senderId:row.sender_id,senderLabel:row.sender_label,timestamp:row.timestamp,date:row.local_date,...excerpt(row.text,query),mediaCount:row.media_count,provenance:provenance(row)})),nextCursor:rows.length>limit?Buffer.from(JSON.stringify({signature,snapshot,row:last.row_id,ms:last.timestamp_ms})).toString('base64url'):null}
}
function message(){
 const {conversationId,messageId}=payload;if(!chatId(conversationId)||!chatId(messageId))throw new InboxError('INVALID_QUERY')
 const row=db.prepare('SELECT * FROM messages WHERE conversation_id=? AND message_id=?').get(conversationId,messageId)
 if(!row)return null
 const sources=db.prepare('SELECT s.*, b.digest FROM sources s JOIN batches b USING(batch_id) WHERE s.conversation_id=? AND s.message_id=? ORDER BY s.batch_id,s.sequence LIMIT 100').all(conversationId,messageId)
 return{...provenance(row),senderId:row.sender_id,senderLabel:row.sender_label,timestamp:row.timestamp,timezone:row.timezone,text:row.text,mediaRefs:JSON.parse(row.media_json),sources:sources.map(source=>({type:WORKBUDDY_CHAT_SOURCE_TYPE,batchId:source.batch_id,sequence:source.sequence,sourceMessageId:source.source_message_id,chunkFile:source.chunk_file,chunkLine:source.chunk_line,extractorVersion:source.extractor_version,manifestDigest:source.digest,mediaRefs:JSON.parse(source.media_json)}))}
}
async function main(){
 if(action==='import')return importBatch()
 if(action==='search')queryOptions()
 if(!await database())return action==='search'?{items:[],nextCursor:null}:action==='stats'?{messages:0,batches:0,conversations:[]}:null
 if(action==='search')return search()
 if(action==='message')return message()
 if(action==='receipt'){if(!chatId(payload.batchId))throw new InboxError('INVALID_QUERY');return existingReceipt(payload.batchId,payload.digest)}
 if(action==='stats')return{messages:db.prepare('SELECT COUNT(*) AS count FROM messages').get().count,batches:db.prepare('SELECT COUNT(*) AS count FROM batches').get().count,conversations:db.prepare('SELECT conversation_id AS conversationId,timezone,message_count AS messages,first_ms AS firstMs,watermark_ms AS watermarkMs FROM conversations ORDER BY conversation_id LIMIT 1000').all()}
 throw new InboxError('INVALID_QUERY')
}
try{const value=await main();db?.close();db=null;parentPort.postMessage({ok:true,value})}catch(error){try{db?.close()}catch{}parentPort.postMessage({ok:false,code:error instanceof InboxError?error.code:'ARCHIVE_UNAVAILABLE'})}
