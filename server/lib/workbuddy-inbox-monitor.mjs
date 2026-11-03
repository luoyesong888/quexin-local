import {opendir} from 'node:fs/promises'
import {join} from 'node:path'
import {absoluteChatPath,checkedPath,readChatFile,parseChatJson,inboxError} from '../../shared/workbuddy-chat-files.mjs'
import {bindingId,WorkBuddyInbox} from './workbuddy-inbox.mjs'

// Optional, failure-isolated monitor. No binding file means no inbox access.
export function startInboxMonitor({dataRoot,projectRoot,intervalMs=5000,onError=()=>{}}){
 const registry=join(absoluteChatPath(dataRoot),'workbuddy-inbox'),controller=new AbortController()
 let timer,stopped=false
 async function tick(){
  if(stopped)return
  try{
   await checkedPath(registry,{privateMode:true});let count=0
   for await(const entry of await opendir(registry)){
    if(stopped)break
    if(++count>100)break
    if(!/^[a-f0-9]{64}$/.test(entry.name))continue
    try{
     const folder=join(registry,entry.name);await checkedPath(folder,{privateMode:true})
     const config=parseChatJson(await readChatFile(folder,'binding.json',4096))
     if(bindingId(config.ownerId,config.spaceId)!==entry.name)continue
     const inbox=new WorkBuddyInbox({dataRoot,projectRoot,ownerId:config.ownerId,spaceId:config.spaceId})
     const result=await inbox.scan({signal:controller.signal})
     if(!result.ok&&result.health.error?.code!=='BUSY')onError(result.health.error)
    }catch(error){onError(inboxError(error))}
   }
  }catch(error){if(error.code!=='ENOENT')onError(inboxError(error))}
  finally{if(!stopped){timer=setTimeout(tick,intervalMs);timer.unref?.()}}
 }
 void tick()
 return()=>{stopped=true;clearTimeout(timer);controller.abort()}
}
