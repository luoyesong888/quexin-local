import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import type { PageProps, RecordItem, PlanItem, Journal } from './domain'
import type { ApiResult, AuthSession, CloudTransport, CoupleSpace, DeviceSession, MaintenanceStatus, NotificationJob, SpaceDeletion, SpaceExportJob, SpaceInvite, SpaceMember, SyncCommand, SystemAlert } from './cloud-contract'
import { formalCloud, localMockCloud } from './cloud-client'
import { Icon,Modal } from './ui'
import { makeId,isDemoStore } from './data'
import {repositoryFor} from './repository'
import {privateEntityKeys,pruneQueuedChanges,shareableEntities} from '../shared/sync-policy.mjs'
import { MAX_SYNC_QUEUE, emptySyncState, nextRetryAt, retryDelayMs, syncStateRepository, type StoredSyncConflict, type SyncWorkspaceState } from './sync-state'
import { fingerprint,stageLocalChanges,syncPayload,syncSignature as makeSyncSignature } from './sync-queue'
import { requestBackgroundSync } from './pwa'
import { announceAccount,prepareAccount } from './account-workspace'
import { canCite,canSharePlan } from './assistant-search'
import './sync-lab.css'
import {SharingLifecycle} from './SharingLifecycle'
import {bindSpace} from './space-lifecycle'

type CloudState = { space: CoupleSpace; members: SpaceMember[] } | null
const FORMAL_CONTEXT_KEY='quexin-formal-context-v1'
function readFormalContext():{session:AuthSession;cloud:NonNullable<CloudState>}|null{
  try{const value=JSON.parse(localStorage.getItem(FORMAL_CONTEXT_KEY)??'null');return value?.session?.userId&&value?.cloud?.space?.id?value:null}catch{return null}
}
function saveFormalContext(session:AuthSession,cloud:NonNullable<CloudState>):void{localStorage.setItem(FORMAL_CONTEXT_KEY,JSON.stringify({session,cloud}))}

function conflictCopy(value:unknown):{title:string;body:string}{
  if(!value||typeof value!=='object')return{title:'已被删除',body:'这一版本已经不存在。'}
  const item=value as Record<string,unknown>
  return{title:String(item.title??'未命名资料'),body:String(item.body??item.date??'没有补充内容').slice(0,180)}
}
async function withSyncLock(name:string,action:()=>Promise<void>):Promise<void>{
  const locks=(navigator as Navigator&{locks?:{request:(name:string,options:{ifAvailable:boolean},callback:(lock:unknown|null)=>Promise<void>)=>Promise<void>}}).locks
  if(!locks)return action()
  await locks.request(name,{ifAvailable:true},async lock=>{if(lock)await action()})
}

function localEntity<T extends object>(value: T): T {
  const { spaceId: _spaceId, ownerId: _ownerId, visibility: _visibility, revision, updatedAt: _updatedAt, deletedAt: _deletedAt, ...entity } = value as T & Record<string, unknown>
  const mediaId=typeof entity.mediaId==='string'?entity.mediaId:''
  return { ...entity,...(_visibility&&_visibility!=='shared'?{sensitive:true}:{}),entityVersion:typeof revision==='number'?revision:undefined,...(mediaId?{image:`/formal/v1/media/${encodeURIComponent(mediaId)}`,imageThumbnail:`/formal/v1/media/${encodeURIComponent(mediaId)}?variant=thumbnail`}:{}) } as T
}

export function SyncLab({ store, setStore, update, notify }: PageProps) {
  const latestStore=useRef(store);latestStore.current=store
  const [mode, setMode] = useState<'formal' | 'mock'>('formal')
  const [authMode, setAuthMode] = useState<'login' | 'register'>('register')
  const [session, setSession] = useState<AuthSession | null>(null)
  const [cloud, setCloud] = useState<CloudState>(null)
  const [loginName, setLoginName] = useState(store.settings.selfName)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [developmentMailbox,setDevelopmentMailbox]=useState(false)
  const [devices, setDevices] = useState<DeviceSession[]>([])
  const [spaceName, setSpaceName] = useState(`${store.settings.selfName}和${store.settings.partnerName}的空间`)
  const [inviteCode, setInviteCode] = useState('')
  const [activeInvite, setActiveInvite] = useState<SpaceInvite | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [meta, setMeta] = useState<SyncWorkspaceState>(()=>emptySyncState())
  const metaRef=useRef(meta)
  const syncingRef=useRef(false)
  const [syncReady,setSyncReady]=useState(false)
  const [syncState,setSyncState]=useState<'idle'|'syncing'|'synced'|'offline'|'conflict'>('idle')
  const [mediaScope,setMediaScope]=useState<'shared'|'private'>('shared')
  const [mediaPreview,setMediaPreview]=useState<{name:string;url:string;width:number;height:number}|null>(null)
  const [exportJob,setExportJob]=useState<SpaceExportJob|null>(null)
  const [deletion,setDeletion]=useState<SpaceDeletion|null>(null)
  const [privacyAction,setPrivacyAction]=useState<'schedule'|'delete-now'|null>(null)
  const [privacyText,setPrivacyText]=useState('')
  const [maintenance,setMaintenance]=useState<MaintenanceStatus|null>(null)
  const [systemAlerts,setSystemAlerts]=useState<SystemAlert[]>([])
  const [notifications,setNotifications]=useState<NotificationJob[]>([])
  const transport: CloudTransport = mode === 'formal' ? formalCloud : localMockCloud
  const workspaceId=session&&cloud?`${mode}:${session.userId}:${cloud.space.id}`:''
  const isSpaceOwner=Boolean(session&&cloud?.members.some(member=>member.userId===session.userId&&member.role==='owner'))

  const sharedRecords = useMemo(() => store.records.filter(canCite), [store.records])
  const sharedPlans = useMemo(() => store.plans.filter(item=>canSharePlan(item,store.records)), [store.plans,store.records])
  const sharedJournals = useMemo(() => store.journals.filter(item => !item.sensitive && !item.title.startsWith('私人草稿 · ') && item.type !== '时光胶囊'), [store.journals])
  const syncSignature=useMemo(()=>`${store.settings.boundSpaceId??''}:${makeSyncSignature(store)}`,[sharedRecords,sharedPlans,sharedJournals,store.settings.boundSpaceId])
  const scheduledRetry=useMemo(()=>nextRetryAt(meta.queue),[meta.queue])
  const longFailures=useMemo(()=>meta.queue.filter(entry=>entry.attempts>=5||Date.now()-new Date(entry.enqueuedAt).getTime()>24*60*60_000),[meta.queue])
  useEffect(()=>{metaRef.current=meta},[meta])

  const commitMeta=async(next:SyncWorkspaceState)=>{metaRef.current=next;setMeta(next);if(workspaceId){await syncStateRepository.save(workspaceId,next);if(mode==='formal'&&next.queue.length)void requestBackgroundSync()}}

  const refresh = async () => {
    if (mode === 'mock' && !localMockCloud.hasToken) return
    const sessionResult = await transport.getSession()
    if (!sessionResult.ok || !sessionResult.data) {
      const cached=mode==='formal'&&(!sessionResult.ok&&sessionResult.error.code==='INTERNAL_ERROR')?readFormalContext():null
      if(cached){setSession(cached.session);setCloud(cached.cloud);setSyncState('offline');setError('正式本地 API 暂时不可用，已从本机缓存恢复账号与空间；变化会保留在离线队列。');return}
      if (mode === 'mock') localMockCloud.logout();if(mode==='formal')localStorage.removeItem(FORMAL_CONTEXT_KEY);setSession(null);setCloud(null);return
    }
    setSession(sessionResult.data)
    if (mode === 'formal') {
      const deviceResult = await formalCloud.listDeviceSessions()
      if (deviceResult.ok) setDevices(deviceResult.data)
      const maintenanceResult=await formalCloud.maintenanceStatus()
      if(maintenanceResult.ok)setMaintenance(maintenanceResult.data)
      const alertsResult=await formalCloud.systemAlerts()
      if(alertsResult.ok)setSystemAlerts(alertsResult.data)
      const notificationsResult=await formalCloud.notifications()
      if(notificationsResult.ok)setNotifications(notificationsResult.data)
    }
    const spaceResult = await transport.getCurrentSpace()
    if (spaceResult.ok){setCloud(spaceResult.data);if(mode==='formal'&&!spaceResult.data)localStorage.removeItem(FORMAL_CONTEXT_KEY);if(mode==='formal'&&spaceResult.data){saveFormalContext(sessionResult.data,spaceResult.data);const deletionResult=await formalCloud.deletionStatus(spaceResult.data.space.id);if(deletionResult.ok)setDeletion(deletionResult.data)}}
    else if(mode==='formal'&&spaceResult.error.code==='INTERNAL_ERROR'){const cached=readFormalContext();if(cached){setCloud(cached.cloud);setSyncState('offline')}}
  }

  useEffect(()=>{let active=true;void formalCloud.authConfig().then(result=>{if(active&&result.ok)setDevelopmentMailbox(result.data.developmentMailbox)});return()=>{active=false}},[])
  useEffect(()=>{const changed=()=>void refresh();window.addEventListener('quexin-space-changed',changed);return()=>window.removeEventListener('quexin-space-changed',changed)},[mode])

  useEffect(() => { setSession(null); setCloud(null); setDevices([]); setActiveInvite(null); setExportJob(null);setDeletion(null);setMaintenance(null);setSystemAlerts([]);setNotifications([]);setPrivacyAction(null);setError(''); setSyncReady(false);setMeta(emptySyncState()); void refresh() }, [mode])
  useEffect(()=>{
    if(!workspaceId){setSyncReady(false);return}
    let active=true;setSyncReady(false)
    void syncStateRepository.load(workspaceId).then(state=>{if(!active)return;metaRef.current=state;setMeta(state);setSyncReady(true)}).catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'无法读取离线同步队列')})
    return()=>{active=false}
  },[workspaceId])
  useEffect(()=>workspaceId?syncStateRepository.subscribe(id=>{if(id!==workspaceId||syncingRef.current)return;void syncStateRepository.load(workspaceId).then(state=>{metaRef.current=state;setMeta(state);if(state.conflicts.length)setSyncState('conflict');else if(!state.queue.length)setSyncState('synced')})}):undefined,[workspaceId])

  const perform = async (name: string, action: () => Promise<void>) => {
    setBusy(name); setError('')
    try { await action() }
    catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败') }
    finally { setBusy('') }
  }
  const requireOk = <T,>(result: ApiResult<T>): T => {
    if (!result.ok) throw new Error(result.error.message)
    return result.data as T
  }

  const login = (event: FormEvent) => {
    event.preventDefault()
    void perform('login', async () => {
      const result = mode === 'formal'
        ? authMode === 'register' ? await formalCloud.register(email, password, loginName) : await formalCloud.login(email, password)
        : await localMockCloud.login(loginName)
      const loggedIn=requireOk<AuthSession>(result)
      if(mode==='formal'){await prepareAccount(loggedIn,authMode==='register'&&Boolean(store.settings.sampleMode));announceAccount(loggedIn);return}
      setSession(loggedIn);setPassword('');await refresh();notify('本地模拟账号已登录')
    })
  }
  const verifyLocalEmail = () => void perform('verify', async () => {
    if (!session?.email) return
    requireOk(await formalCloud.requestEmailVerification())
    const mail = requireOk(await formalCloud.devLatestToken(session.email, 'verify_email'))
    requireOk(await formalCloud.verifyEmail(mail.token)); await refresh(); notify('邮箱已通过本地开发邮件箱验证')
  })
  const resendEmail=()=>void perform('resend',async()=>{requireOk(await formalCloud.requestEmailVerification());notify('验证链接已加入发送队列，请查看最新邮件')})
  const revokeDevice = (device: DeviceSession) => void perform(`device-${device.id}`, async () => {
    const result = requireOk(await formalCloud.revokeDeviceSession(device.id))
    if (result.current) { announceAccount(null);setSession(null); setCloud(null); setDevices([]); notify('当前设备会话已退出') }
    else { setDevices(items => items.filter(item => item.id !== device.id)); notify('该登录设备已撤销') }
  })
  const createSpace = () => void perform('space', async () => {
    const result = await transport.createSpace({ name: spaceName, selfDisplayName: store.settings.selfName })
    const created=requireOk(result);if(mode==='formal')setStore(value=>bindSpace(value,created.space.id)); await refresh();window.dispatchEvent(new Event('quexin-space-changed')); notify(mode==='formal'?'正式本地情侣空间已创建':'本地模拟情侣空间已创建')
  })
  const acceptInvite = () => void perform('accept', async () => {
    const result = await transport.acceptInvite(inviteCode, store.settings.selfName)
    const joined=requireOk(result);if(mode==='formal')setStore(value=>bindSpace(value,joined.space.id)); setInviteCode(''); await refresh();window.dispatchEvent(new Event('quexin-space-changed')); notify('已加入情侣空间')
  })
  const createInvite = () => void perform('invite', async () => {
    if (!cloud) return
    const result = await transport.createInvite(cloud.space.id, 24)
    setActiveInvite(requireOk<SpaceInvite>(result)); notify('24 小时模拟邀请码已生成')
  })

  const pushChanges=async(base:SyncWorkspaceState,force=false)=>{
    if(!cloud)return{meta:base,count:0,conflicts:0}
    let source=latestStore.current
    if(mode==='formal'){
      if(!session?.userId)throw new Error('没有可核对的账号，已暂停发送')
      const saved=await repositoryFor(session.userId).load()
      if(!isDemoStore(saved.snapshot))throw new Error('无法核对当前资料，已暂停发送旧同步队列')
      source=saved.snapshot
      if(source.settings.boundSpaceId&&source.settings.boundSpaceId!==cloud.space.id)throw new Error('资料仍属于旧空间，正在转为私人归档，请稍后重试')
    }
    const prepared=stageLocalChanges(base,source),staged={...prepared,queue:pruneQueuedChanges(prepared.queue,latestStore.current)}
    const revisions={...staged.revisions},hashes={...staged.hashes},queue=staged.queue;await commitMeta(staged)
    if(!queue.length)return{meta:staged,count:0,conflicts:0}
    const now=Date.now(),eligible=queue.filter(entry=>force||!entry.nextAttemptAt||new Date(entry.nextAttemptAt).getTime()<=now)
    if(!eligible.length)return{meta:staged,count:0,conflicts:0}
    let result
    try{if(mode==='formal'){const authenticated=requireOk(await formalCloud.getSession());if(authenticated?.userId!==session?.userId){announceAccount(authenticated);throw new Error('账号已切换，原账号队列暂停提交')}}result=requireOk(await transport.sync(cloud.space.id,eligible.map(entry=>entry.command),mode==='formal'?session?.userId:undefined))}
    catch(cause){const message=cause instanceof Error?cause.message:'同步请求失败',eligibleIds=new Set(eligible.map(entry=>entry.command.commandId)),attemptedAt=new Date().toISOString();const failed={...staged,queue:queue.map(entry=>{if(!eligibleIds.has(entry.command.commandId))return entry;const attempts=entry.attempts+1;return{...entry,attempts,lastError:message,lastAttemptAt:attemptedAt,nextAttemptAt:new Date(Date.now()+retryDelayMs(attempts)).toISOString()}})};await commitMeta(failed);throw cause}
    const entriesByCommand=new Map(queue.map(entry=>[entry.command.commandId,entry])),acceptedIds=new Set(result.accepted.map(item=>item.commandId)),conflictIds=new Set(result.conflicts.map(item=>item.commandId))
    for(const accepted of result.accepted){const entry=entriesByCommand.get(accepted.commandId);if(entry){revisions[entry.key]=accepted.revision;hashes[entry.key]=entry.hash}}
    const nextConflicts=[...staged.conflicts]
    for(const conflict of result.conflicts){const entry=entriesByCommand.get(conflict.commandId);if(!entry)continue;const existing=nextConflicts.findIndex(item=>item.key===entry.key);const stored:StoredSyncConflict={...conflict,key:entry.key,localPayload:entry.command.payload,detectedAt:new Date().toISOString()};if(existing>=0)nextConflicts[existing]=stored;else nextConflicts.push(stored)}
    return{meta:{...staged,revisions,hashes,queue:queue.filter(entry=>!acceptedIds.has(entry.command.commandId)&&!conflictIds.has(entry.command.commandId)),conflicts:nextConflicts},count:result.accepted.length,conflicts:result.conflicts.length}
  }

  const pullChanges=async(base:SyncWorkspaceState,silent=false):Promise<{meta:SyncWorkspaceState;count:number}>=>{
    if(!cloud)return{meta:base,count:0}
    const page=requireOk(await transport.changes(cloud.space.id,base.cursor)),revisions={...base.revisions},hashes={...base.hashes}
    const deleted=new Map<string,Set<string>>([['record',new Set()],['plan',new Set()],['journal',new Set()]])
    page.events.forEach(event=>{const key=`${event.entity}:${event.entityId}`;revisions[key]=event.revision;if(event.operation==='delete'){deleted.get(event.entity)?.add(event.entityId);hashes[key]='__deleted__'}})
    const absorb=(entity:'record'|'plan'|'journal',item:RecordItem|PlanItem|Journal&{revision:number;deletedAt?:string})=>{const cloudItem=item as typeof item&{revision:number;deletedAt?:string};const key=`${entity}:${item.id}`;revisions[key]=cloudItem.revision;if(!cloudItem.deletedAt)hashes[key]=(cloudItem as unknown as {visibility?:string}).visibility&&(cloudItem as unknown as {visibility?:string}).visibility!=='shared'?'__private__':fingerprint(syncPayload(localEntity(cloudItem)))}
    page.records.forEach(item=>absorb('record',item as unknown as RecordItem&{revision:number;deletedAt?:string}));page.plans.forEach(item=>absorb('plan',item as unknown as PlanItem&{revision:number;deletedAt?:string}));page.journals.forEach(item=>absorb('journal',item as unknown as Journal&{revision:number;deletedAt?:string}))
    const merge=<T extends{id:string;image?:string;imageThumbnail?:string;mediaId?:string}>(local:T[],remote:T[],removed:Set<string>,privateKeys:Set<string>,kind:string)=>{const remoteIds=new Set(remote.map(item=>item.id)),localById=new Map(local.map(item=>[item.id,item]));return[...local.filter(item=>privateKeys.has(`${kind}:${item.id}`)||!remoteIds.has(item.id)&&!removed.has(item.id)),...remote.filter(item=>!privateKeys.has(`${kind}:${item.id}`)&&!(item as T&{deletedAt?:string}).deletedAt).map(item=>{const normalized=localEntity(item),previous=localById.get(item.id);return !normalized.mediaId&&previous?.image?{...normalized,image:previous.image,imageThumbnail:previous.imageThumbnail}:normalized})]}
    if(page.events.length){
      const apply=(value:typeof store)=>{const privateKeys=privateEntityKeys(value);return {...value,records:merge(value.records,page.records as unknown as RecordItem[],deleted.get('record')!,privateKeys,'record'),plans:merge(value.plans,page.plans as unknown as PlanItem[],deleted.get('plan')!,privateKeys,'plan'),journals:merge(value.journals,page.journals as unknown as Journal[],deleted.get('journal')!,privateKeys,'journal')}}
      if(silent)setStore(apply);else update(apply,`已拉取 ${page.events.length} 项变化`)
    }
    return{meta:{...base,cursor:page.nextCursor,revisions,hashes},count:page.events.length}
  }

  const runSyncCycle=async(silent=false,force=false)=>{
    if(syncingRef.current||!cloud)return
    await withSyncLock(`quexin-workspace:${workspaceId||cloud.space.id}`,async()=>{
      syncingRef.current=true;setSyncState('syncing')
      try{
        const latest=workspaceId?await syncStateRepository.load(workspaceId):metaRef.current
        const pushed=await pushChanges(latest,force)
        const pulled=await pullChanges(pushed.meta,silent),next={...pulled.meta,lastSyncedAt:new Date().toISOString()}
        await commitMeta(next)
        if(next.conflicts.length){setSyncState('conflict');setError(`${next.conflicts.length} 条资料发生版本冲突，请在下方选择保留版本`)}
        else{setSyncState('synced');setError('');if(!silent)notify(`同步完成：提交 ${pushed.count} 项，拉取 ${pulled.count} 项`)}
      }catch(cause){
        if(navigator.onLine)try{const pulled=await pullChanges(metaRef.current,true);await commitMeta(pulled.meta)}catch{}
        setSyncState(navigator.onLine?'idle':'offline');setError(cause instanceof Error?cause.message:'自动同步失败')
      }
      finally{syncingRef.current=false}
    })
  }
  const syncNow=()=>void perform('sync',()=>runSyncCycle(false,true))
  const pullNow=()=>void perform('pull',async()=>{const pulled=await pullChanges(metaRef.current,false),next={...pulled.meta,lastSyncedAt:new Date().toISOString()};await commitMeta(next);setSyncState(next.conflicts.length?'conflict':'synced')})

  useEffect(()=>{
    if(mode!=='formal'||!session||!cloud||!syncReady)return
    const timer=window.setTimeout(()=>void runSyncCycle(true),1400)
    return()=>window.clearTimeout(timer)
  },[mode,session?.userId,cloud?.space.id,syncSignature,syncReady])
  useEffect(()=>{
    if(mode!=='formal'||!session||!cloud||!syncReady)return
    const refreshChanges=()=>{if(document.visibilityState==='visible'&&navigator.onLine)void runSyncCycle(true)}
    const interval=window.setInterval(refreshChanges,15_000)
    window.addEventListener('online',refreshChanges);document.addEventListener('visibilitychange',refreshChanges)
    return()=>{window.clearInterval(interval);window.removeEventListener('online',refreshChanges);document.removeEventListener('visibilitychange',refreshChanges)}
  },[mode,session?.userId,cloud?.space.id,syncReady])
  useEffect(()=>{
    if(mode!=='formal'||!session||!cloud||!syncReady||!scheduledRetry)return
    const delay=Math.max(250,new Date(scheduledRetry).getTime()-Date.now())
    const timer=window.setTimeout(()=>void runSyncCycle(true),delay)
    return()=>window.clearTimeout(timer)
  },[mode,session?.userId,cloud?.space.id,syncReady,scheduledRetry])

  const applyConflictValue=(conflict:StoredSyncConflict,value:unknown,message:string)=>{
    const remote=value&&typeof value==='object'?value as Record<string,unknown>:null,removed=!remote||Boolean(remote.deletedAt)
    const normalized=remote&&!removed?localEntity({...remote,revision:conflict.actualRevision}):null
    update(current=>{
      const merge=<T extends{id:string}>(items:T[])=>removed?items.filter(item=>item.id!==conflict.entityId):[...items.filter(item=>item.id!==conflict.entityId),normalized as unknown as T]
      if(conflict.entity==='record')return{...current,records:merge(current.records)}
      if(conflict.entity==='plan')return{...current,plans:merge(current.plans)}
      if(conflict.entity==='journal')return{...current,journals:merge(current.journals)}
      return current
    },message)
  }
  const resolveConflict=(conflict:StoredSyncConflict,choice:'cloud'|'local')=>void perform(`conflict-${conflict.commandId}`,async()=>{
    const base=metaRef.current,revisions={...base.revisions,[conflict.key]:conflict.actualRevision},hashes={...base.hashes},remaining=base.conflicts.filter(item=>item.commandId!==conflict.commandId),queue=base.queue.filter(entry=>entry.key!==conflict.key)
    if(!shareableEntities(latestStore.current).some(({entity,item})=>`${entity}:${item.id}`===conflict.key)){
      await commitMeta({...base,queue,conflicts:remaining});setSyncState(remaining.length?'conflict':'idle');setError('');notify('资料已删除或不再共享，已取消旧冲突提交');return
    }
    if(choice==='cloud'){
      const server=conflict.serverValue&&typeof conflict.serverValue==='object'?conflict.serverValue as Record<string,unknown>:null
      hashes[conflict.key]=!server||server.deletedAt?'__deleted__':fingerprint(syncPayload(localEntity(server) as unknown as RecordItem|PlanItem|Journal))
      applyConflictValue(conflict,conflict.serverValue,'已采用云端版本')
      const next={...base,revisions,hashes,queue,conflicts:remaining};await commitMeta(next);setSyncState(remaining.length?'conflict':'synced');setError(remaining.length?`还有 ${remaining.length} 条冲突待处理`:'')
      return
    }
    applyConflictValue(conflict,conflict.localPayload,'已恢复本地版本，准备重新同步')
    const command={commandId:makeId(),entity:conflict.entity,entityId:conflict.entityId,operation:conflict.actualRevision?'update':'create',expectedRevision:conflict.actualRevision||null,payload:conflict.localPayload,clientTime:new Date().toISOString()} satisfies SyncCommand
    queue.push({key:conflict.key,hash:fingerprint(conflict.localPayload),command,enqueuedAt:new Date().toISOString(),attempts:0})
    const next={...base,revisions,hashes,queue,conflicts:remaining};await commitMeta(next);setSyncState('idle');setError('');void runSyncCycle(false,true)
  })

  const uploadPhoto=(event:ChangeEvent<HTMLInputElement>)=>{
    const file=event.target.files?.[0];event.target.value='';if(!file||!cloud)return
    void perform('media',async()=>{const uploaded=requireOk(await formalCloud.uploadImage(cloud.space.id,file,mediaScope));setMediaPreview({name:file.name,url:formalCloud.mediaUrl(uploaded.thumbnailUrl),width:uploaded.width,height:uploaded.height});notify(mediaScope==='shared'?'图片已私密存储，可由双方读取':'图片已私密存储，仅自己可读取')})
  }
  const exportQueue=()=>{
    const payload={exportedAt:new Date().toISOString(),workspaceId,queue:meta.queue,conflicts:meta.conflicts,lastSyncedAt:meta.lastSyncedAt}
    const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'})),link=document.createElement('a')
    link.href=url;link.download=`quexin-sync-diagnostics-${new Date().toISOString().slice(0,10)}.json`;document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);notify('同步诊断已导出，请妥善保管，其中可能包含记录正文')
  }
  const downloadExport=(job:SpaceExportJob)=>{const link=document.createElement('a');link.href=formalCloud.exportDownloadUrl(job.downloadUrl);link.download='';document.body.appendChild(link);link.click();link.remove()}
  const createServerExport=()=>void perform('server-export',async()=>{if(!cloud)return;const result=requireOk(await formalCloud.exportSpace(cloud.space.id));setExportJob(result);downloadExport(result);notify('正式空间数据包已生成，下载链接 24 小时内有效')})
  const scheduleSpaceDeletion=()=>void perform('schedule-deletion',async()=>{if(!cloud)return;const result=requireOk(await formalCloud.deleteSpace(cloud.space.id,privacyText));setDeletion({deletionId:result.deletionId,scheduledAt:result.scheduledAt});setPrivacyAction(null);setPrivacyText('');notify('空间已预约在 7 天后删除，可在到期前撤销')})
  const cancelSpaceDeletion=()=>void perform('cancel-deletion',async()=>{if(!cloud)return;requireOk(await formalCloud.cancelDeletion(cloud.space.id));setDeletion(null);notify('空间删除预约已撤销')})
  const deleteSpaceImmediately=()=>void perform('delete-now',async()=>{if(!cloud)return;const id=workspaceId;requireOk(await formalCloud.deleteSpaceNow(cloud.space.id,privacyText));if(id)await syncStateRepository.remove(id);localStorage.removeItem(FORMAL_CONTEXT_KEY);setCloud(null);setDeletion(null);setExportJob(null);setPrivacyAction(null);setPrivacyText('');metaRef.current=emptySyncState();setMeta(emptySyncState());notify('正式空间及其服务端媒体已永久删除，本浏览器资料仍保留')})

  const logout = () => void perform('logout', async () => { if (mode === 'formal'){requireOk(await formalCloud.logout());announceAccount(null)}else localMockCloud.logout(); setSession(null); setCloud(null); setActiveInvite(null); setMediaPreview(null);setSyncReady(false);metaRef.current=emptySyncState();setMeta(emptySyncState()); notify('已退出账号，离线队列和本地资料均未删除') })

  return <section data-testid="sync-lab" className={`panel sync-lab ${mode === 'formal' && session?.emailVerified === false ? 'needs-verification' : ''}`}>
    <div className="panel-heading"><div><span className="life-kicker">LOCAL SYNC LAB</span><h3>双人同步实验室</h3></div><span className="tag">{mode === 'formal' ? '正式 API · 本机数据库' : '快速模拟'}</span></div>
    <div className="segmented sync-lab-mode"><button className={mode === 'formal' ? 'active' : ''} onClick={() => { setMode('formal'); setSession(null); setCloud(null); setMeta(emptySyncState()); setError('') }}>正式账号</button><button className={mode === 'mock' ? 'active' : ''} onClick={() => { setMode('mock'); setSession(null); setCloud(null); setMeta(emptySyncState()); setError('') }}>快速模拟</button></div>
    <p className="sync-lab-note"><Icon name="info" size={16}/>{mode === 'formal' ? `使用邮箱账号连接本机双人空间。邮件按服务端配置投递。${developmentMailbox?'本机演示环境也提供邮件预览。':''}` : '用于快速验证邀请和同步，不使用真实密码、短信、邮件或数据库。'}</p>
    {error && <p className="sync-lab-error" role="alert">{error}</p>}
    {mode === 'formal' && session?.emailVerified === false && <div className="sync-email-verify"><Icon name="mail" size={25}/><div><h4>先验证邮箱</h4><p>请打开最新验证邮件中的链接。没有收到时可以重新发送。</p></div><button className="btn primary" disabled={Boolean(busy)} onClick={resendEmail}>{busy==='resend'?'正在发送…':'重新发送验证邮件'}</button>{developmentMailbox&&<button className="btn secondary" disabled={Boolean(busy)} onClick={verifyLocalEmail}>{busy==='verify'?'正在验证…':'使用开发邮件箱完成验证'}</button>}</div>}
    {!session ? <form className={`sync-lab-form ${mode === 'formal' ? 'is-formal' : ''}`} onSubmit={login}>{mode === 'formal'&&<><div className="segmented sync-auth-mode"><button type="button" className={authMode === 'register' ? 'active' : ''} onClick={() => setAuthMode('register')}>注册</button><button type="button" className={authMode === 'login' ? 'active' : ''} onClick={() => setAuthMode('login')}>登录</button></div><label className="field"><span>邮箱</span><input required type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com"/></label></>}{(mode === 'mock' || authMode === 'register')&&<label className="field"><span>{mode === 'formal' ? '你的称呼' : '模拟账号名称'}</span><input required maxLength={30} value={loginName} onChange={event => setLoginName(event.target.value)} placeholder="例如：阿澄"/></label>}{mode === 'formal'&&<label className="field"><span>密码</span><input required type="password" minLength={10} maxLength={128} autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} placeholder="至少 10 个字符"/></label>}<button className="btn primary" disabled={Boolean(busy)} type="submit">{busy === 'login' ? '正在处理…' : mode === 'formal' ? authMode === 'register' ? '注册并登录' : '登录正式本地账号' : '登录本地模拟账号'}</button></form>
      : !cloud ? <div className="sync-lab-onboarding"><div className="sync-lab-user"><Icon name="users" size={22}/><span><strong>{session.displayName}</strong><small>{mode === 'formal' ? '正式本地账号' : '本地模拟账号'}</small></span><button className="core-text-button" onClick={logout}>退出</button></div><div className="sync-lab-two"><div><h4>创建情侣空间</h4><label className="field"><span>空间名称</span><input value={spaceName} onChange={event => setSpaceName(event.target.value)}/></label><button className="btn primary" disabled={Boolean(busy)} onClick={createSpace}>{busy === 'space' ? '正在创建…' : '创建空间'}</button></div><div><h4>使用邀请码加入</h4><label className="field"><span>6 位邀请码</span><input value={inviteCode} maxLength={12} onChange={event => setInviteCode(event.target.value.toUpperCase())} placeholder="例如：QX7K2P"/></label><button className="btn secondary" disabled={!inviteCode.trim() || Boolean(busy)} onClick={acceptInvite}>{busy === 'accept' ? '正在加入…' : '加入空间'}</button></div></div></div>
        : <div className="sync-lab-connected"><div className="sync-lab-space"><div><small>{mode === 'formal' ? '当前正式本地空间' : '当前模拟空间'}</small><h4>{cloud.space.name}</h4></div><span>{cloud.members.length}/2 人</span></div><div className="sync-lab-members">{cloud.members.map(member => <div key={member.userId}><span>{member.displayName.slice(0,1)}</span><strong>{member.displayName}<small>{member.role === 'owner' ? '创建者' : '伴侣'}</small></strong></div>)}</div>{cloud.members.length < 2 && <div className="sync-lab-invite">{activeInvite ? <><span>邀请码</span><strong>{activeInvite.code}</strong><small>{new Date(activeInvite.expiresAt).toLocaleString('zh-CN')} 前有效</small></> : <button className="btn secondary" disabled={Boolean(busy)} onClick={createInvite}>{busy === 'invite' ? '正在生成…' : '生成伴侣邀请码'}</button>}</div>}<div className="sync-lab-stats"><span>{sharedRecords.length}<small>共享回忆</small></span><span>{sharedPlans.length}<small>计划</small></span><span>{sharedJournals.length}<small>信件/手记</small></span></div>{mode==='formal'&&<div className={`sync-auto-state state-${syncState}`} aria-live="polite"><i className="status-dot"/><span><strong>{syncState==='syncing'?'正在自动同步':syncState==='conflict'?'需要核对冲突':syncState==='offline'?'等待网络恢复':meta.queue.length?`${meta.queue.length} 项等待同步`:'自动同步已开启'}</strong><small>{meta.lastSyncedAt?`最近完成 ${new Date(meta.lastSyncedAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})} · 离线队列 ${meta.queue.length} 项`:'变化先写入 IndexedDB 离线队列，再自动提交'}</small></span></div>}<div className="sync-lab-actions"><button className="btn primary" disabled={Boolean(busy)||syncState==='syncing'||!syncReady} onClick={syncNow}><Icon name="refresh" size={16}/>{busy === 'sync'||syncState==='syncing' ? '正在同步…' : '立即同步'}</button><button className="btn secondary" disabled={Boolean(busy)||syncState==='syncing'||!syncReady} onClick={pullNow}><Icon name="download" size={16}/>{busy === 'pull' ? '正在拉取…' : '只拉取变化'}</button></div>{meta.conflicts.length>0&&<section className="sync-conflicts"><div className="panel-heading"><div><span className="life-kicker">CONFLICT CENTER</span><h4>版本冲突待确认</h4></div><span className="tag sensitive">{meta.conflicts.length} 条</span></div>{meta.conflicts.map(conflict=>{const local=conflictCopy(conflict.localPayload),server=conflictCopy(conflict.serverValue);return <article key={conflict.commandId}><header><Icon name="refresh" size={17}/><strong>{conflict.entity==='record'?'回忆':conflict.entity==='plan'?'计划':'文字'} · {conflict.entityId}</strong><small>{new Date(conflict.detectedAt).toLocaleString('zh-CN')}</small></header><div><section><span>本机版本</span><h5>{local.title}</h5><p>{local.body}</p></section><section><span>云端版本</span><h5>{server.title}</h5><p>{server.body}</p></section></div><footer><button className="btn secondary" disabled={Boolean(busy)} onClick={()=>resolveConflict(conflict,'cloud')}>采用云端</button><button className="btn primary" disabled={Boolean(busy)} onClick={()=>resolveConflict(conflict,'local')}>保留本机并重试</button></footer></article>})}</section>}{mode==='formal'&&<section className="sync-media"><div><span className="life-kicker">PRIVATE MEDIA</span><h4>私有照片存储</h4><p>上传后会在本机重新编码、去除元数据并生成缩略图；不会保存未经处理的原文件。</p></div><div className="segmented sync-media-scope"><button className={mediaScope==='shared'?'active':''} onClick={()=>setMediaScope('shared')}>双方可见</button><button className={mediaScope==='private'?'active':''} onClick={()=>setMediaScope('private')}>仅自己</button></div><label className={`sync-media-picker btn secondary ${busy==='media'?'disabled':''}`}><Icon name="image" size={17}/>{busy==='media'?'正在安全处理…':'选择一张照片'}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={Boolean(busy)} onChange={uploadPhoto}/></label>{mediaPreview&&<figure className="sync-media-preview"><img src={mediaPreview.url} alt={mediaPreview.name}/><figcaption><strong>{mediaPreview.name}</strong><small>{mediaPreview.width} × {mediaPreview.height} · WebP 缩略图 · 受登录权限保护</small></figcaption></figure>}</section>}<p className="muted">敏感记录、私人草稿、周期信息和未到期胶囊不会进入资料同步；照片走独立的受保护媒体通道。</p><button className="core-text-button" onClick={logout}>退出{mode === 'formal' ? '正式本地账号' : '模拟账号'}</button></div>}
    {session&&cloud&&longFailures.length>0&&<p className="sync-long-failure" role="alert"><Icon name="bell" size={16}/>有 {longFailures.length} 项变化已多次失败或等待超过 24 小时，请检查正式 API、登录状态或导出诊断。</p>}
    {session&&cloud&&meta.queue.length>0&&<details data-testid="sync-queue-inspector" className="sync-queue-inspector"><summary><span><Icon name="database" size={15}/><strong>离线队列诊断</strong></span><small>{meta.queue.length}/{MAX_SYNC_QUEUE} 项{scheduledRetry?` · 下次重试 ${new Date(scheduledRetry).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}`:''}</small></summary><div>{meta.queue.slice(0,12).map(entry=><article key={entry.command.commandId}><span><strong>{entry.command.entity==='record'?'回忆':entry.command.entity==='plan'?'计划':'文字'} · {entry.command.entityId}</strong><small>{entry.command.operation==='create'?'新建':entry.command.operation==='delete'?'删除':'更新'} · 已尝试 {entry.attempts} 次</small></span><em>{entry.lastError??'等待首次提交'}</em></article>)}{meta.queue.length>12&&<p>还有 {meta.queue.length-12} 项未展开显示。</p>}<button className="btn small secondary" onClick={exportQueue}><Icon name="download" size={13}/>导出同步诊断</button></div></details>}
    {session&&cloud&&mode==='formal'&&<section data-testid="formal-data-privacy" className="sync-data-privacy"><div className="panel-heading"><div><span className="life-kicker">DATA & PRIVACY</span><h4>正式数据与隐私</h4></div><Icon name="shield" size={20}/></div><div className="sync-privacy-row"><span><Icon name="download" size={18}/><strong>导出正式空间数据<small>包含你有权限读取的共享/私人资料与媒体，压缩包 24 小时有效。</small></strong></span><button className="btn secondary" disabled={Boolean(busy)} onClick={createServerExport}>{busy==='server-export'?'正在生成…':'生成数据包'}</button></div>{exportJob&&<div className="sync-export-ready"><span><strong>最近导出已就绪</strong><small>{(exportJob.byteSize/1024).toFixed(1)} KB · 到期 {new Date(exportJob.expiresAt).toLocaleString('zh-CN')}</small></span><button className="core-text-button" onClick={()=>downloadExport(exportJob)}>再次下载</button></div>}<div className="sync-privacy-row danger"><span><Icon name="trash" size={18}/><strong>删除正式情侣空间<small>{isSpaceOwner?'先预约 7 天后删除，可撤销；也提供需要完整口令的立即永久删除。':'只有空间创建者可以预约或永久删除。'}</small></strong></span>{isSpaceOwner&&!deletion&&<button className="btn danger" disabled={Boolean(busy)} onClick={()=>{setPrivacyText('');setPrivacyAction('schedule')}}>预约删除</button>}</div>{deletion&&<div className="sync-deletion-pending" role="status"><span><strong>已预约删除</strong><small>预计 {new Date(deletion.scheduledAt).toLocaleString('zh-CN')}</small></span><button className="btn secondary" disabled={Boolean(busy)} onClick={cancelSpaceDeletion}>撤销预约</button><button className="btn danger" disabled={Boolean(busy)} onClick={()=>{setPrivacyText('');setPrivacyAction('delete-now')}}>立即永久删除</button></div>}</section>}
    {session&&mode==='formal'&&maintenance&&<div className={`sync-maintenance status-${maintenance.status}`}><Icon name="settings" size={17}/><span><strong>后台维护：{maintenance.status==='success'?'正常':maintenance.status==='partial'?'部分完成':'失败'}</strong><small>最近运行 {new Date(maintenance.completedAt).toLocaleString('zh-CN')} · 清理导出 {maintenance.expiredExports} · 删除空间 {maintenance.deletedSpaces} · 清理媒体 {maintenance.removedMedia}</small></span></div>}
    {session&&mode==='formal'&&systemAlerts.length>0&&<section className="sync-system-alerts" aria-label="系统告警"><div className="panel-heading"><div><span className="life-kicker">SYSTEM ALERTS</span><h4>系统告警</h4></div><span className="tag sensitive">{systemAlerts.length} 条</span></div>{systemAlerts.map(alert=><article key={alert.id}><Icon name="bell" size={16}/><span><strong>{alert.message}</strong><small>{alert.code} · {new Date(alert.createdAt).toLocaleString('zh-CN')}</small></span></article>)}</section>}
    {session&&mode==='formal'&&notifications.length>0&&<div className="sync-maintenance"><Icon name="mail" size={17}/><span><strong>通知投递队列</strong><small>{notifications.map(job=>`${job.kind}:${job.status}${job.provider?`(${job.provider})`:''}${job.providerMessageId?` · ${job.providerMessageId}`:''}`).join(' · ')}</small></span></div>}
    {!session && mode === 'formal' && authMode === 'login' && <a className="sync-forgot" href="#account/forgot">忘记密码？通过邮件重置</a>}
    {session && mode === 'formal' && <div className="sync-devices"><div className="panel-heading"><div><span className="life-kicker">SESSION SECURITY</span><h4>登录设备</h4></div><span className="tag">{devices.length} 个</span></div>{devices.map(device => <div className="sync-device" key={device.id}><Icon name="shield" size={19}/><span><strong>{device.current ? '当前设备' : device.userAgent || '未知设备'}</strong><small>最近使用 {new Date(device.lastSeenAt).toLocaleString('zh-CN')}</small></span>{!device.current && <button className="core-text-button" disabled={Boolean(busy)} onClick={() => revokeDevice(device)}>撤销</button>}</div>)}</div>}
    {privacyAction==='schedule'&&cloud&&<Modal title="预约删除正式空间？" onClose={()=>setPrivacyAction(null)}><p>预约后将在 7 天后进入删除流程，到期前可以撤销。浏览器里的本地资料不会一起删除。</p><label className="field"><span>输入完整空间名称确认</span><input autoFocus value={privacyText} onChange={event=>setPrivacyText(event.target.value)} placeholder={cloud.space.name}/></label><div className="modal-actions"><button className="btn secondary" onClick={()=>setPrivacyAction(null)}>返回</button><button className="btn danger" disabled={privacyText!==cloud.space.name||Boolean(busy)} onClick={scheduleSpaceDeletion}>{busy==='schedule-deletion'?'正在预约…':'确认预约删除'}</button></div></Modal>}
    {privacyAction==='delete-now'&&cloud&&<Modal title="立即永久删除正式空间" onClose={()=>setPrivacyAction(null)}><p>这会立即删除 PostgreSQL 中的空间、成员关系、同步记录、导出任务和服务端媒体文件，无法恢复。本浏览器里的本地资料仍会保留。</p><label className="field"><span>输入“永久删除 {cloud.space.name}”</span><input autoFocus value={privacyText} onChange={event=>setPrivacyText(event.target.value)} placeholder={`永久删除 ${cloud.space.name}`}/></label><div className="modal-actions"><button className="btn secondary" onClick={()=>setPrivacyAction(null)}>返回</button><button className="btn danger" disabled={privacyText!==`永久删除 ${cloud.space.name}`||Boolean(busy)} onClick={deleteSpaceImmediately}>{busy==='delete-now'?'正在永久删除…':'永久删除，无法恢复'}</button></div></Modal>}
    {session&&mode==='formal'&&<SharingLifecycle store={store} update={update} notify={notify} session={session} space={cloud?.space??null} onChanged={refresh}/>}
  </section>
}
