import type { DemoStore } from './domain'
import type { SyncCommand } from './cloud-contract'
import { MAX_SYNC_QUEUE,type SyncWorkspaceState } from './sync-state'
import {fingerprint,syncPayload,shareableEntities,pruneQueuedChanges,privateEntityKeys} from '../shared/sync-policy.mjs'
export {fingerprint,syncPayload,shareableEntities,pruneQueuedChanges} from '../shared/sync-policy.mjs'

type SyncKind='record'|'plan'|'journal'

export function syncSignature(store:DemoStore):string{return fingerprint(shareableEntities(store).map(({entity,item})=>({entity,payload:syncPayload(item)})))}

export function stageLocalChanges(base:SyncWorkspaceState,store:DemoStore):SyncWorkspaceState{
  const shared=new Map(shareableEntities(store).map(({entity,item})=>[`${entity}:${item.id}`,syncPayload(item)]))
  const conflicts=base.conflicts.filter(item=>shared.has(item.key))
  const queue=pruneQueuedChanges(base.queue,store),queuedKeys=new Set(queue.map(entry=>entry.key)),conflictKeys=new Set(conflicts.map(conflict=>conflict.key)),present=new Set<string>()
  const enqueue=(key:string,hash:string,command:SyncCommand)=>{
    if(queue.length>=MAX_SYNC_QUEUE)throw new Error(`离线队列已达到 ${MAX_SYNC_QUEUE} 项上限，请先恢复连接并完成同步`)
    queue.push({key,hash,command,enqueuedAt:new Date().toISOString(),attempts:0});queuedKeys.add(key)
  }
  for(const {entity,item} of shareableEntities(store)){
    const key=`${entity}:${item.id}`,payload=syncPayload(item),hash=fingerprint(payload);present.add(key)
    if(base.hashes[key]===hash||queuedKeys.has(key)||conflictKeys.has(key))continue
    enqueue(key,hash,{commandId:crypto.randomUUID(),entity,entityId:item.id,operation:base.hashes[key]==='__private__'?'publish':base.revisions[key]?'update':'create',expectedRevision:base.revisions[key]??null,payload,clientTime:new Date().toISOString()})
  }
  for(const [key,revision] of Object.entries(base.revisions)){
    const separator=key.indexOf(':'),entity=key.slice(0,separator) as SyncKind,entityId=key.slice(separator+1)
    if(!['record','plan','journal'].includes(entity)||present.has(key)||['__deleted__','__private__'].includes(base.hashes[key])||queuedKeys.has(key)||conflictKeys.has(key))continue
    const withdrawal=privateEntityKeys(store).has(key)
    enqueue(key,withdrawal?'__private__':'__deleted__',{commandId:crypto.randomUUID(),entity,entityId,operation:withdrawal?'withdraw':'delete',expectedRevision:revision,payload:{visibility:'shared'},clientTime:new Date().toISOString()})
  }
  const same=queue.length===base.queue.length&&queue.every((entry,i)=>entry===base.queue[i])&&conflicts.length===base.conflicts.length&&conflicts.every((entry,i)=>entry===base.conflicts[i])
  return same?base:{...base,queue,conflicts}
}
