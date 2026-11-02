import { useEffect,useState } from 'react'
import type { AuthSession } from './cloud-contract'
import { formalCloud } from './cloud-client'
import App from './App'
import { repositoryFor } from './repository'
import { createEmptyStore,initialStore } from './data'

const channel=typeof BroadcastChannel==='undefined'?null:new BroadcastChannel('quexin-account-switch')
export function announceAccount(session:AuthSession|null){
  localStorage.removeItem('quexin-formal-context-v1')
  if(session)localStorage.setItem('quexin-active-account',JSON.stringify(session));else localStorage.removeItem('quexin-active-account')
  if(window.location.hash==='#settings')window.history.replaceState({quexinIntent:'space'},'',window.location.href)
  window.dispatchEvent(new CustomEvent('quexin-account-changed',{detail:session}))
  channel?.postMessage('changed')
}
export async function prepareAccount(session:AuthSession,sample=false){
  const repository=repositoryFor(session.userId)
  if(!(await repository.load()).snapshot){const seed=sample?structuredClone(initialStore):createEmptyStore();seed.settings.onboardingCompleted=true;if(!sample)seed.settings.selfName=session.displayName;await repository.save(seed)}
}
export function WorkspaceGate(){
  const [identity,setIdentity]=useState<AuthSession|null|undefined>(undefined)
  const [failure,setFailure]=useState('')
  useEffect(()=>{
    let active=true
    const check=async()=>{
      const result=await formalCloud.getSession();if(!active)return
      if(result.ok){if(result.data)await prepareAccount(result.data);if(!active)return;setIdentity(result.data);if(result.data)localStorage.setItem('quexin-active-account',JSON.stringify(result.data))}
      else if(result.error.code==='UNAUTHENTICATED'){setIdentity(null);localStorage.removeItem('quexin-active-account');localStorage.removeItem('quexin-formal-context-v1')}
      else{try{setIdentity(JSON.parse(localStorage.getItem('quexin-active-account')??'null'))}catch{setIdentity(null)}}
    }
    const changed=(event:Event)=>setIdentity((event as CustomEvent<AuthSession|null>).detail)
    const reportFailure=()=>{if(active)setFailure('账号资料库暂时无法打开，请刷新后重试。')}
    const crossTab=()=>{setIdentity(undefined);setFailure('');void check().catch(reportFailure)}
    void check().catch(reportFailure);window.addEventListener('quexin-account-changed',changed);channel?.addEventListener('message',crossTab)
    return()=>{active=false;window.removeEventListener('quexin-account-changed',changed);channel?.removeEventListener('message',crossTab)}
  },[])
  if(identity===undefined)return <main className="account-page">{failure?<><p role="alert">{failure}</p><button className="btn secondary" onClick={()=>window.location.reload()}>刷新重试</button></>:<p role="status">正在打开你的资料空间…</p>}</main>
  return <App key={identity?.userId??'guest'} accountId={identity?.userId??''}/>
}
