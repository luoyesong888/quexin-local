import { useEffect,useRef,useState } from 'react'
import type { Dispatch,SetStateAction } from 'react'
import type { DemoStore } from './domain'
import type { SpaceMember,CoupleSpace } from './cloud-contract'
import { formalCloud } from './cloud-client'
import { applyCompanionAction, type CompanionAction,type CompanionState } from '../shared/companion.mjs'
import {archiveSpace,bindSpace} from './space-lifecycle'
import {syncStateRepository} from './sync-state'
import {announceAccount} from './account-workspace'

export type PetActionInput=Omit<CompanionAction,'commandId'>
type Context={space:CoupleSpace;members:SpaceMember[]}
type Queue={id:string;state:CompanionState|null;actions:CompanionAction[]}
const request=<T,>(r:IDBRequest<T>)=>new Promise<T>((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})
async function database(){const r=indexedDB.open('quexin-companion',1);r.onupgradeneeded=()=>r.result.createObjectStore('queues',{keyPath:'id'});return request(r)}
async function load(id:string):Promise<Queue>{const db=await database();try{return await request(db.transaction('queues').objectStore('queues').get(id))??{id,state:null,actions:[]}}finally{db.close()}}
async function save(row:Queue){const db=await database();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('queues','readwrite');tx.objectStore('queues').put(row);tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error)})}finally{db.close()}}
export async function clearCompanionQueues(userId:string){const db=await database();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('queues','readwrite'),store=tx.objectStore('queues'),r=store.getAllKeys();r.onsuccess=()=>{for(const key of r.result)if(String(key).startsWith(userId+':'))store.delete(key)};tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)})}finally{db.close()}}
async function lock<T>(id:string,action:()=>Promise<T>):Promise<T>{return navigator.locks?navigator.locks.request(`quexin-companion:${id}`,action):action()}

export function useCompanion(store:DemoStore,setStore:Dispatch<SetStateAction<DemoStore>>,accountId:string,ready:boolean){
  const [context,setContext]=useState<Context|null>(null),[pending,setPending]=useState(0),[error,setError]=useState(''),[growthSources,setGrowthSources]=useState<Array<{sourceId:string;title:string;contribution:number;addedAt:string}>>([])
  const generation=useRef(0),busy=useRef(false),contextRef=useRef(context);contextRef.current=context
  const syncRef=useRef<()=>Promise<void>>(async()=>{})
  function apply(state:CompanionState,ctx:Context){
    const actor=ctx.members.find(m=>m.userId===accountId);if(!actor)return
    if(state.growthSources)setGrowthSources(state.growthSources)
    setStore(value=>{
      value=bindSpace(value,ctx.space.id)
      const settings={...value.settings,selfName:(actor.role==='owner'?state.profile.ownerName:state.profile.partnerName)||actor.displayName,partnerName:(actor.role==='owner'?state.profile.partnerName:state.profile.ownerName)||'待加入的伙伴',since:state.profile.since}
      if(JSON.stringify(value.pet)===JSON.stringify(state.pet)&&JSON.stringify(value.settings)===JSON.stringify(settings))return value
      return{...value,pet:state.pet,settings}
    })
  }
  async function sync(){
    const ctx=contextRef.current,version=generation.current;if(!ctx||busy.current)return
    busy.current=true
    try{await lock(`${accountId}:${ctx.space.id}`,async()=>{
      const row=await load(`${accountId}:${ctx.space.id}`)
      const session=await formalCloud.getSession()
      if(!session.ok&&session.error.code==='UNAUTHENTICATED'){announceAccount(null);return}
      if(!session.ok||session.data?.userId!==accountId)throw new Error('共同空间暂未连接，操作会保存在此账号的本机队列')
      const current=await formalCloud.getCurrentSpace()
      if(current.ok&&current.data?.space.id!==ctx.space.id){window.dispatchEvent(new Event('quexin-space-changed'));return}
      if(current.ok&&current.data){const changed=JSON.stringify(ctx.members)!==JSON.stringify(current.data.members);ctx.members=current.data.members;if(changed)window.dispatchEvent(new Event('quexin-space-changed'))}
      while(row.actions.length){
        const result=await formalCloud.companionAction(ctx.space.id,row.actions[0],accountId);if(!result.ok)throw new Error(result.error.message)
        row.state=result.data;row.actions.shift();await save(row)
      }
      const latest=await formalCloud.companion(ctx.space.id);if(!latest.ok)throw new Error(latest.error.message)
      row.state=latest.data;await save(row)
      if(version===generation.current){apply(latest.data,ctx);setPending(0);setError('')}
    })}catch(cause){if(version===generation.current)setError(cause instanceof Error?cause.message:'共同空间连接失败')}finally{busy.current=false}
  }
  syncRef.current=sync
  useEffect(()=>{
    if(!accountId||!ready)return
    const version=++generation.current
    let discovery=0
    const discover=async()=>{
      const request=++discovery,result=await formalCloud.getCurrentSpace();if(version!==generation.current||request!==discovery)return
      let ctx:Context|null=null
      if(result.ok)ctx=result.data
      else if(result.error.code==='INTERNAL_ERROR'){try{const cached=JSON.parse(localStorage.getItem('quexin-formal-context-v1')??'null');if(cached?.session?.userId===accountId)ctx=cached.cloud}catch{}}
      contextRef.current=ctx;setContext(ctx)
      if(result.ok&&!ctx){localStorage.removeItem('quexin-formal-context-v1');setStore(value=>value.settings.boundSpaceId?archiveSpace(value,value.settings.boundSpaceId):value);await clearCompanionQueues(accountId);await syncStateRepository.removeAccount(accountId);setPending(0)}
      if(ctx)setStore(value=>bindSpace(value,ctx!.space.id))
      if(ctx){try{const identity=JSON.parse(localStorage.getItem('quexin-active-account')??'null');if(identity?.userId===accountId){localStorage.setItem('quexin-formal-context-v1',JSON.stringify({session:identity,cloud:ctx}));window.dispatchEvent(new Event('quexin-sync-context-ready'))}}catch{}}
      if(ctx){const row=await load(`${accountId}:${ctx.space.id}`);if(version!==generation.current)return;setPending(row.actions.length);if(row.state){let projected=row.state;const actor=ctx.members.find(m=>m.userId===accountId)!;for(const action of row.actions)projected=applyCompanionAction(projected,action,actor);apply(projected,ctx)}void syncRef.current()}
    }
    void discover().catch(()=>setError('共同空间读取失败'))
    const changed=()=>void discover(),tick=()=>void syncRef.current()
    const timer=window.setInterval(tick,3000)
    window.addEventListener('quexin-space-changed',changed);window.addEventListener('online',changed)
    return()=>{generation.current++;window.clearInterval(timer);window.removeEventListener('quexin-space-changed',changed);window.removeEventListener('online',changed)}
  },[accountId,ready])
  const act=(input:PetActionInput)=>{
    const ctx=contextRef.current;if(!ctx)return
    const version=generation.current,action={...input,commandId:crypto.randomUUID()}
    void lock(`${accountId}:${ctx.space.id}`,async()=>{
      const row=await load(`${accountId}:${ctx.space.id}`),actor=ctx.members.find(m=>m.userId===accountId)!
      if(!row.state)throw new Error('请等待共同空间加载完成后再操作')
      if(row.actions.length>=500)throw new Error('待同步操作已达上限，请连接后重试')
      row.actions.push(action);await save(row)
      let projected=row.state;for(const queued of row.actions)projected=applyCompanionAction(projected,queued,actor)
      if(version===generation.current){apply(projected,ctx);setPending(row.actions.length);setError('')}
    }).then(()=>syncRef.current()).catch(cause=>setError(cause instanceof Error?cause.message:'操作保存失败'))
  }
  return{action:context?act:undefined,connected:Boolean(context),pending,error,growthSources,retry:()=>void syncRef.current()}
}
