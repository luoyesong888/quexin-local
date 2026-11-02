let registrationRequested = false
let messageListenerInstalled=false

type SyncRegistration=ServiceWorkerRegistration&{sync?:{register:(tag:string)=>Promise<void>}}

export async function requestBackgroundSync():Promise<boolean>{
  if(typeof window==='undefined'||!window.isSecureContext||!('serviceWorker'in navigator))return false
  const registration=await navigator.serviceWorker.getRegistration('/') as SyncRegistration|undefined
  if(!registration?.sync)return false
  try{await registration.sync.register('quexin-sync');return true}catch{return false}
}

export function registerPwa(): void {
  if (!import.meta.env.PROD || typeof window === 'undefined' || !window.isSecureContext || !('serviceWorker' in navigator) || registrationRequested) return
  registrationRequested = true
  if(!messageListenerInstalled){
    messageListenerInstalled=true
    navigator.serviceWorker.addEventListener('message',event=>{
      if(event.data?.type==='quexin-sync-updated')window.dispatchEvent(new CustomEvent('quexin-background-sync',{detail:event.data}))
    })
  }

  const register = () => {
    void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(error => {
      console.warn('鹊信离线缓存暂时不可用，在线功能仍可正常使用。', error)
    })
  }

  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register, { once: true })
}
