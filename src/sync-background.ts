import { useEffect,useMemo,useState } from 'react'
import type { DemoStore } from './domain'
import { requestBackgroundSync } from './pwa'
import { stageLocalChanges,syncSignature } from './sync-queue'
import { syncStateRepository } from './sync-state'

const FORMAL_CONTEXT_KEY='quexin-formal-context-v1'
type CachedContext={session:{userId:string};cloud:{space:{id:string}}}

function cachedContext():CachedContext|null{
  try{const value=JSON.parse(localStorage.getItem(FORMAL_CONTEXT_KEY)??'null');return value?.session?.userId&&value?.cloud?.space?.id?value:null}catch{return null}
}

async function withStageLock<T>(name:string,action:()=>Promise<T>):Promise<T|undefined>{
  const locks=(navigator as Navigator&{locks?:{request:<R>(name:string,callback:()=>Promise<R>)=>Promise<R>}}).locks
  return locks?locks.request(name,action):action()
}

export function useFormalSyncStager(store:DemoStore,ready=true,accountId=''):void{
  const [contextVersion,setContextVersion]=useState(0)
  useEffect(()=>{const changed=()=>setContextVersion(value=>value+1);window.addEventListener('quexin-sync-context-ready',changed);return()=>window.removeEventListener('quexin-sync-context-ready',changed)},[])
  const signature=useMemo(()=>syncSignature(store),[store.records,store.plans,store.journals])
  useEffect(()=>{
    if(!ready)return
    const context=cachedContext();if(!context||context.session.userId!==accountId)return
    if(store.settings.boundSpaceId&&store.settings.boundSpaceId!==context.cloud.space.id)return
    const workspaceId=`formal:${context.session.userId}:${context.cloud.space.id}`,timer=window.setTimeout(()=>{
      void withStageLock(`quexin-workspace:${workspaceId}`,async()=>{
        const current=await syncStateRepository.load(workspaceId),next=stageLocalChanges(current,store)
        if(next===current)return
        await syncStateRepository.save(workspaceId,next)
        await requestBackgroundSync()
      }).catch(error=>console.warn('鹊信后台入队失败',error))
    },700)
    return()=>window.clearTimeout(timer)
  },[signature,ready,accountId,contextVersion,store.settings.boundSpaceId])
}
