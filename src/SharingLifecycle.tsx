import {useEffect,useState} from 'react'
import type {AuthSession,CoupleSpace} from './cloud-contract'
import type {PageProps} from './domain'
import {formalCloud} from './cloud-client'
import {Modal} from './ui'
import {archiveSpace} from './space-lifecycle'
import {syncStateRepository} from './sync-state'
import {clearCompanionQueues} from './companion-sync'
import {repositoryFor} from './repository'
import {announceAccount} from './account-workspace'
import {exportBackup} from './data'

type Sharing={entities:Array<{entity:'record'|'plan'|'journal';id:string;title:string;visibility:string;revision:number}>;media:Array<{id:string;title:string;visibility:string}>}
type Props=Pick<PageProps,'store'|'update'|'notify'>&{session:AuthSession;space:CoupleSpace|null;onChanged:()=>Promise<void>}
export function SharingLifecycle({store,update,notify,session,space,onChanged}:Props){
 const [sharing,setSharing]=useState<Sharing>({entities:[],media:[]}),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const [confirm,setConfirm]=useState<{kind:'entity'|'media'|'leave'|'account';id?:string;entity?:'record'|'plan'|'journal';title?:string;revision?:number}|null>(null)
 const [confirmation,setConfirmation]=useState(''),[password,setPassword]=useState('')
 const refresh=async()=>{if(!space)return;const result=await formalCloud.sharing(space.id);if(!result.ok)throw new Error(result.error.message);setSharing(result.data)}
 useEffect(()=>{let active=true;setSharing({entities:[],media:[]});if(space)void formalCloud.sharing(space.id).then(r=>{if(!active)return;if(r.ok)setSharing(r.data);else setError(r.error.message)});return()=>{active=false}},[space?.id])
 const open=(next:NonNullable<typeof confirm>)=>{setConfirm(next);setConfirmation('');setPassword('');setError('')}
 const run=async()=>{
  if(!confirm)return;setBusy(true);setError('')
  try{
   if(confirm.kind==='account'){
    const result=await formalCloud.deleteAccount(password,confirmation);if(!result.ok)throw new Error(result.error.message)
    let localCleanupFailed=false
    try{await syncStateRepository.removeAccount(session.userId);await clearCompanionQueues(session.userId);await repositoryFor(session.userId).clear()}catch{localCleanupFailed=true}
    sessionStorage.setItem('quexin-lifecycle-notice',localCleanupFailed?'服务端账号已注销；本机清理未完成，请在浏览器设置中清理此网站的数据。':result.data.cleanupPending?'账号已注销，访问权限已撤销；部分服务端文件等待本机维护重试。':'账号已注销，本浏览器的账号资料已清除。自行保存的备份和其他设备副本不受影响。')
    announceAccount(null);return
   }
   if(!space)throw new Error('当前没有共同空间')
   if(confirm.kind==='leave'){
    const result=await formalCloud.leaveSpace(space.id,confirmation);if(!result.ok)throw new Error(result.error.message)
    localStorage.removeItem('quexin-formal-context-v1');await syncStateRepository.removeAccount(session.userId);await clearCompanionQueues(session.userId)
    update(value=>archiveSpace(value,space.id),result.data.cleanupPending?'已退出空间，本机资料已归档；部分服务端文件等待维护重试':'已退出共同空间，本机资料保留为私人归档')
    window.dispatchEvent(new Event('quexin-space-changed'));await onChanged();setConfirm(null);return
   }
   if(confirm.kind==='media'){
    const result=await formalCloud.withdrawMedia(confirm.id!);if(!result.ok)throw new Error(result.error.message)
    update(value=>({...value,records:value.records.map(item=>item.mediaId===confirm.id?{...item,sensitive:true,mediaScope:'private'}:item)}),'照片已撤回，旧导出链接已失效')
   }else{
    const result=await formalCloud.withdraw(space.id,confirm.entity!,confirm.id!,confirm.revision!);if(!result.ok)throw new Error(result.error.message)
    update(value=>({...value,records:confirm.entity==='record'?value.records.map(item=>item.id===confirm.id?{...item,sensitive:true}:item):value.records,plans:confirm.entity==='plan'?value.plans.map(item=>item.id===confirm.id?{...item,sensitive:true}:item):value.plans,journals:confirm.entity==='journal'?value.journals.map(item=>item.id===confirm.id?{...item,sensitive:true}:item):value.journals}),'资料已撤回，另一成员不能再通过服务端读取')
   }
   await refresh();setConfirm(null);notify('撤回已确认；已下载、截图或另存的副本无法远程抹除')
  }catch(e){setError(e instanceof Error?e.message:'操作失败，请重试')}finally{setBusy(false)}
 }
 const required=confirm?.kind==='account'?'注销我的账号':confirm?.kind==='leave'?`退出 ${space?.name}`:''
 return <section className="panel sharing-lifecycle" aria-label="共享与账号管理">
  <div className="panel-heading"><h3>共享与账号管理</h3>{space&&<button className="btn secondary small" disabled={busy} onClick={()=>void refresh().catch(e=>setError(e.message))}>刷新共享状态</button>}</div>
  <p className="muted">撤回会限制新的读取，并使此前生成的数据包失效。已下载、截图或另存的内容无法远程删除。</p>
  {error&&<p role="alert">{error}</p>}
  {space&&<><h4>我分享的资料</h4>{sharing.entities.length?sharing.entities.map(item=><div className="sharing-row" key={`${item.entity}:${item.id}`}><span><strong>{item.title}</strong><small>{item.visibility==='shared'?'共享中':'仅自己 · 服务端已确认'}</small></span>{item.visibility==='shared'&&<button className="btn secondary small" onClick={()=>open({kind:'entity',...item})}>撤回共享</button>}</div>):<p className="muted">目前没有由你创建的已同步资料。</p>}
  <h4>我上传的照片</h4>{sharing.media.map(item=><div className="sharing-row" key={item.id}><span><strong>{item.title}</strong><small>{item.visibility==='shared'?'双方可读取':'仅自己 · 服务端已确认'}</small></span>{item.visibility==='shared'&&<button className="btn secondary small" onClick={()=>open({kind:'media',...item})}>撤回照片</button>}</div>)}
  <button className="btn secondary" onClick={()=>open({kind:'leave'})}>退出共同空间</button></>}
  <button className="btn danger" onClick={()=>open({kind:'account'})}>注销账号</button>
  {confirm&&<Modal title={confirm.kind==='account'?'注销账号':confirm.kind==='leave'?'退出共同空间':`撤回${confirm.title??'共享内容'}`} onClose={()=>{if(!busy)setConfirm(null)}}>
   {confirm.kind==='leave'?<><p>撤回并删除你在该空间的服务端资料和照片，旧导出链接失效。本机记录保留为私人归档，不会自动分享到新的空间。</p><p>如果还有另一位成员，空间归对方继续使用，小鹊保留状态、重新整理成长手记；如果没有其他成员，服务端空间删除。此操作不能直接撤销。</p></>:confirm.kind==='account'?<><p>注销账号及所有会话，退出共同空间并删除本人服务端资料。本浏览器中该账号的资料、私人草稿和待同步队列也会清空。</p><p>另一成员的资料与留下的空间保留。其他设备的离线副本、截图、下载和你自行保存的备份不会远程抹除。</p></>:<p>{confirm.kind==='media'?'这张照片的原图、缩略图及由你创建的关联记录将撤回；其他作者的文字不会被删除。':'这条记录和你上传的关联照片将仅自己可通过服务端读取；另一成员下次同步会移除撤回记录。'}此前生成的数据包链接失效。</p>}
   {(confirm.kind==='account'||confirm.kind==='leave')&&<button className="btn secondary" onClick={()=>exportBackup(store)}>先导出本机备份</button>}
   <form onSubmit={event=>{event.preventDefault();void run()}} className="life-form">
    {required&&<label className="field">输入“{required}”确认<input aria-label="操作确认文字" value={confirmation} onChange={e=>setConfirmation(e.target.value)} autoComplete="off"/></label>}
    {confirm.kind==='account'&&<label className="field">当前密码<input aria-label="注销确认密码" type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></label>}
    {error&&<p role="alert">{error}</p>}
    <button type="submit" className="btn danger" disabled={busy||Boolean(required&&confirmation!==required)||confirm.kind==='account'&&!password}>{busy?'正在处理…':confirm.kind==='account'?'确认注销账号':confirm.kind==='leave'?'确认退出空间':'确认撤回'}</button>
   </form>
  </Modal>}
 </section>
}
