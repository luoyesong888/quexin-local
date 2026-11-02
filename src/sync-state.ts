import type { SyncCommand, SyncConflict } from './cloud-contract'

const DATABASE_NAME='quexin-sync-state'
const DATABASE_VERSION=1
const STORE_NAME='workspaces'
const listeners=new Set<(id:string)=>void>()
const channel=typeof BroadcastChannel==='undefined'?null:new BroadcastChannel('quexin-sync-state-v1')
const announce=(id:string)=>{for(const listener of listeners)listener(id)}
if(channel)channel.onmessage=event=>{if(event.data?.type==='workspace-saved'&&typeof event.data.id==='string')announce(event.data.id)}
if(typeof window!=='undefined')window.addEventListener('quexin-background-sync',event=>{const id=(event as CustomEvent<{workspaceId?:string}>).detail?.workspaceId;if(id)announce(id)})

export type SyncQueueEntry={
  key:string
  hash:string
  command:SyncCommand
  enqueuedAt:string
  attempts:number
  lastError?:string
  lastAttemptAt?:string
  nextAttemptAt?:string
}

export type StoredSyncConflict=SyncConflict&{
  key:string
  localPayload:unknown
  detectedAt:string
}

export type SyncWorkspaceState={
  cursor:string
  revisions:Record<string,number>
  hashes:Record<string,string>
  queue:SyncQueueEntry[]
  conflicts:StoredSyncConflict[]
  lastSyncedAt:string
}

type WorkspaceRow=SyncWorkspaceState&{id:string}

export const emptySyncState=():SyncWorkspaceState=>({cursor:'',revisions:{},hashes:{},queue:[],conflicts:[],lastSyncedAt:''})
export const MAX_SYNC_QUEUE=500
export const MAX_RETRY_DELAY_MS=5*60_000

export function retryDelayMs(attempts:number):number{
  return Math.min(MAX_RETRY_DELAY_MS,2_000*2**Math.max(0,Math.min(8,attempts-1)))
}

export function nextRetryAt(queue:SyncQueueEntry[]):string{
  return queue.map(entry=>entry.nextAttemptAt??'').filter(Boolean).sort()[0]??''
}

function openDatabase():Promise<IDBDatabase>{
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DATABASE_NAME,DATABASE_VERSION)
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE_NAME))request.result.createObjectStore(STORE_NAME,{keyPath:'id'})}
    request.onsuccess=()=>resolve(request.result)
    request.onerror=()=>reject(request.error??new Error('无法打开同步队列'))
  })
}

function resultOf<T>(request:IDBRequest<T>):Promise<T>{return new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error??new Error('同步队列读写失败'))})}
function done(transaction:IDBTransaction):Promise<void>{return new Promise((resolve,reject)=>{transaction.oncomplete=()=>resolve();transaction.onabort=()=>reject(transaction.error??new Error('同步队列事务已取消'));transaction.onerror=()=>reject(transaction.error??new Error('同步队列事务失败'))})}

export const syncStateRepository={
  async load(id:string):Promise<SyncWorkspaceState>{
    const database=await openDatabase()
    try{
      const transaction=database.transaction(STORE_NAME,'readonly')
      const row=await resultOf(transaction.objectStore(STORE_NAME).get(id)) as WorkspaceRow|undefined
      await done(transaction)
      if(!row)return emptySyncState()
      const {id:_id,...state}=row
      return {...emptySyncState(),...state,queue:Array.isArray(state.queue)?state.queue:[],conflicts:Array.isArray(state.conflicts)?state.conflicts:[]}
    }finally{database.close()}
  },
  async save(id:string,state:SyncWorkspaceState):Promise<void>{
    const database=await openDatabase()
    try{
      const transaction=database.transaction(STORE_NAME,'readwrite',{durability:'strict'})
      transaction.objectStore(STORE_NAME).put(structuredClone({id,...state}))
      await done(transaction)
      channel?.postMessage({type:'workspace-saved',id})
      announce(id)
    }finally{database.close()}
  },
  async remove(id:string):Promise<void>{
    const database=await openDatabase()
    try{const transaction=database.transaction(STORE_NAME,'readwrite');transaction.objectStore(STORE_NAME).delete(id);await done(transaction);channel?.postMessage({type:'workspace-saved',id})}finally{database.close()}
  },
  async removeAccount(userId:string):Promise<void>{
    const database=await openDatabase()
    try{const tx=database.transaction(STORE_NAME,'readwrite'),store=tx.objectStore(STORE_NAME),keys=await resultOf(store.getAllKeys());for(const key of keys)if(String(key).startsWith(`formal:${userId}:`))store.delete(key);await done(tx)}finally{database.close()}
  },
  subscribe(listener:(id:string)=>void):()=>void{listeners.add(listener);return()=>listeners.delete(listener)},
}
