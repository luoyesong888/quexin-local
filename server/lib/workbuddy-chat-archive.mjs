import {Worker} from 'node:worker_threads'
import {InboxError,chatId} from '../../shared/workbuddy-chat-files.mjs'

// SQLite work stays off the API event loop. No model/network operation is involved.
export function archiveOperation(options,action,payload={}, {signal,onProgress=()=>{},timeoutMs=120_000}={}){
 if(!chatId(options.ownerId)||!chatId(options.spaceId))throw new InboxError('UNSAFE_PATH')
 if(!['import','search','message','stats','receipt'].includes(action))throw new InboxError('INVALID_QUERY')
 return new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(new InboxError('CANCELLED'));return}
  const worker=new Worker(new URL('./workbuddy-chat-archive-worker.mjs',import.meta.url),{
   workerData:{options:{dataRoot:options.dataRoot,projectRoot:options.projectRoot,ownerId:options.ownerId,spaceId:options.spaceId},action,payload},
   execArgv:['--experimental-sqlite'],stdout:true,stderr:true,
  })
  // Do not forward database errors, SQL text or experimental-module diagnostics to logs.
  worker.stdout.resume();worker.stderr.resume();let done=false
  const finish=async(error,value)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);await worker.terminate();if(error)reject(error);else resolve(value)}
  const cancel=()=>void finish(new InboxError('CANCELLED'))
  const timer=setTimeout(()=>void finish(new InboxError('ARCHIVE_TIMEOUT')),timeoutMs)
  signal?.addEventListener('abort',cancel,{once:true})
  worker.on('message',message=>{
   if(message.type==='progress'){try{onProgress(message.value)}catch{cancel()}return}
   void finish(message.ok?null:new InboxError(message.code),message.value)
  })
  worker.once('error',()=>void finish(new InboxError('ARCHIVE_UNAVAILABLE')))
  worker.once('exit',()=>{if(!done)void finish(new InboxError('ARCHIVE_UNAVAILABLE'))})
 })
}
