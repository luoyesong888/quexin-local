import {useEffect,useRef,useState} from 'react'
import type {PageProps,RecordItem} from './domain'
import {chatRequest,workbuddyIntent,type ChatBatch,type ChatCandidate,type ChatOriginal,type ChatPreview,type ChatSearch,type ChatSearchItem,type ChatStatus} from './workbuddy-chat'
import './workbuddy-chat.css'

const labels:Record<string,string>={waiting:'等你确认',validating:'正在校验',ready:'已校验',processing:'正在归档',completed:'已归档',failed:'需要处理'}
const approvalKey=(batch:ChatBatch)=>`${batch.batchId}:${batch.digest}`
const stamp=(value:string)=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})

// Raw messages, queries, previews and unconfirmed candidates are transient React
// state: never assistantMessages, IndexedDB, sync queue or ordinary model history.
export function useWorkBuddyConversation({accountId='',store,setStore,go,notify}:PageProps){
 const [status,setStatus]=useState<ChatStatus|null>(null),[open,setOpen]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[working,setWorking]=useState('')
 const [root,setRoot]=useState(''),[password,setPassword]=useState(''),[allow,setAllow]=useState<string[]>([])
 const [conversation,setConversation]=useState(''),[query,setQuery]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState(''),[sender,setSender]=useState('')
 const [result,setResult]=useState<ChatSearch|null>(null),[selected,setSelected]=useState<ChatSearchItem[]>([]),[original,setOriginal]=useState<ChatOriginal|null>(null)
 const [preview,setPreview]=useState<ChatPreview|null>(null),[sendConsent,setSendConsent]=useState(false),[candidates,setCandidates]=useState<ChatCandidate[]>([])
 const controller=useRef<AbortController|null>(null),mounted=useRef(true),scope=useRef<ChatStatus['scope']|null>(null)
 const refresh=async(signal?:AbortSignal)=>{
  const value=await chatRequest<ChatStatus>('status',accountId,{},signal)
  if(!mounted.current||signal?.aborted)return value
  if(value.scope.ownerId!==accountId)throw new Error('账号已经变化，请刷新后重试。')
  if(scope.current&&scope.current.spaceId!==value.scope.spaceId){setResult(null);setSelected([]);setPreview(null);setCandidates([]);setOriginal(null);setConversation('');setNotice('空间已变化，请重新选择聊天。')}
  scope.current=value.scope;setStatus(value)
  setConversation(current=>value.stats.conversations.some(row=>row.conversationId===current)?current:value.stats.conversations[0]?.conversationId??'')
  return value
 }
 useEffect(()=>{
  mounted.current=true
  const background=new AbortController()
  if(accountId)void refresh(background.signal).catch(()=>{})
  const timer=window.setInterval(()=>{if(accountId&&!controller.current)void refresh(background.signal).catch(()=>{})},30_000)
  return()=>{mounted.current=false;background.abort();controller.current?.abort();window.clearInterval(timer)}
 },[accountId])
 const run=async(label:string,task:(signal:AbortSignal)=>Promise<void>)=>{
  if(controller.current)return
  const abort=new AbortController();controller.current=abort;setWorking(label);setError('');setNotice('')
  try{await task(abort.signal)}catch(cause){if(mounted.current)setError(abort.signal.aborted?'已停止等待。若归档已经完成会保留，请重新检查批次状态。':cause instanceof Error?cause.message:'操作未完成，请重试。')}
  finally{if(controller.current===abort)controller.current=null;if(mounted.current)setWorking('')}
 }
 const request=<T,>(action:string,body:object,signal:AbortSignal)=>chatRequest<T>(action,accountId,{expectedSpaceId:scope.current?.spaceId,...body},signal)
 const search=async(signal:AbortSignal,cursor='',text=query,conversationId=conversation)=>{
  if(!conversationId){setNotice('还没有归档聊天。先确认一个待接收批次。');return}
  const value=await request<ChatSearch>('search',{conversationId,query:text,from,to,senderId:sender,cursor},signal)
  if(signal.aborted)return
  setResult(value);setSelected([]);setOriginal(null);setPreview(null);setSendConsent(false);setCandidates([])
 }
 const prepare=async(signal:AbortSignal)=>{
  if(!selected.length){setNotice('请先检索聊天，再勾选要整理的少量片段。');return}
  const value=await request<ChatPreview>('preview',{refs:selected.map(({conversationId,messageId})=>({conversationId,messageId}))},signal)
  if(!signal.aborted){setPreview(value);setCandidates([]);setSendConsent(false)}
 }
 const handleCommand=(text:string)=>{
  if(!workbuddyIntent(text))return false
  setOpen(true)
  if(!accountId){setError('请先登录本机账号，再连接自己的聊天资料。');return true}
  void run('正在检查聊天资料',async signal=>{
   const latest=await refresh(signal)
   if(/整理/.test(text)){await prepare(signal);return}
   const keyword=text.match(/(?:搜索|查找|检索)(?:.*?(?:聊天记录|聊天归档|聊天片段))?[：:\s]+(.+)$/)?.[1]
   if(keyword){setQuery(keyword.slice(0,200));await search(signal,'',keyword.slice(0,200),conversation||latest.stats.conversations[0]?.conversationId||'')}
  })
  return true
 }
 const reset=()=>{controller.current?.abort();setOpen(false);setResult(null);setSelected([]);setPreview(null);setCandidates([]);setOriginal(null);setQuery('');setError('');setNotice('')}
 const receive=(batch:ChatBatch)=>void run('正在校验文件并建立本地归档',async signal=>{
  setAllow(value=>value.filter(id=>id!==approvalKey(batch)))
  const timer=window.setInterval(()=>{void request<{messages:number;total:number}|null>('progress',{},signal).then(value=>{if(value?.total&&!signal.aborted)setWorking(`正在归档 ${value.messages} / ${value.total} 条消息`)}).catch(()=>{})},2000)
  try{await request('receive',{batchId:batch.batchId,digest:batch.digest,consent:true},signal)}finally{window.clearInterval(timer)}
  const latest=await refresh(signal),item=latest.batches.find(row=>row.batchId===batch.batchId)
  if(!signal.aborted)setNotice(`归档完成：新增 ${item?.receipt?.added??0} 条，跳过 ${item?.receipt?.duplicates??0} 条重复消息。可以检索聊天了。`)
 })
 const organize=(mode:'local'|'model')=>void run(mode==='local'?'正在本机整理片段':'正在用已确认片段整理候选',async signal=>{
  if(!preview)return
  const approved=preview;setPreview(null);setSendConsent(false)
  const value=await request<{candidates:ChatCandidate[]}>('organize',{previewId:approved.previewId,digest:approved.digest,mode,consent:true},signal)
  if(!signal.aborted){setCandidates(value.candidates);setNotice(value.candidates.length?'候选尚未保存。请核对标题、内容、日期和原文，再逐条确认。':'这些片段暂时没有可保存的候选。')}
 })
 const save=(candidate:ChatCandidate)=>void run('正在核对账号并保存',async signal=>{
  const previous=scope.current?.spaceId,latest=await refresh(signal)
  if(previous!==latest.scope.spaceId||signal.aborted)throw new Error('空间发生变化，请重新整理。')
  if(!candidate.title.trim()||!candidate.body.trim())throw new Error('请填写标题和内容。')
  if((candidate.kind==='回忆'||candidate.kind==='计划')&&!candidate.date)throw new Error('请核对并补充这条候选的日期。')
  const row=candidate.excerpt,ref=row.source
  const record:RecordItem={id:candidate.id,title:candidate.title.trim(),body:candidate.body.trim(),date:candidate.date,kind:candidate.kind,status:'confirmed',sensitive:true,mediaScope:'private',
   source:`WorkBuddy 聊天 · ${row.senderLabel} · ${row.timestamp}`,provenance:{type:'workbuddy-chat',batchId:ref.batchId,label:`WorkBuddy · ${row.senderLabel}`,line:ref.sequence,original:row.text,mapped:row.text,importedAt:new Date().toISOString(),baseDate:candidate.date,
    chatRef:{...latest.scope,conversationId:row.conversationId,messageId:row.messageId,timestamp:row.timestamp,chunkFile:ref.chunkFile,chunkLine:ref.chunkLine,manifestDigest:ref.manifestDigest,extractorVersion:ref.extractorVersion}}}
  setStore(current=>current.records.some(item=>item.id===record.id)?current:{...current,records:[record,...current.records]})
  notify('已保存为私人记录，未加入共享资料。')
 })
 const updateCandidate=(id:string,field:Partial<ChatCandidate>)=>setCandidates(items=>items.map(item=>item.id===id?{...item,...field}:item))
 const pending=status?.batches.filter(batch=>batch.status==='waiting').length??0
 const panel=!open?(pending>0?<button className="wb-discovery" onClick={()=>setOpen(true)}>青鸟发现 {pending} 个 WorkBuddy 新批次 · 查看读取范围</button>:null):<section className="wb-chat-card" aria-label="青鸟聊天资料">
  <header><strong>青鸟 · 聊天资料</strong><button className="text-link" onClick={reset}>收起并清除预览</button></header>
  <p>WorkBuddy 提取后放进文件夹，由鹊信读取。原始聊天仅在本机当前账号归档；不会自动成为共同回忆。</p>
  {error&&<p role="alert" className="wb-error">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {!accountId?<button className="btn secondary" onClick={()=>go('settings','space')}>前往登录本机账号</button>:<>
   <button className="text-link" disabled={!!working} onClick={()=>void run('正在检查交换箱',async signal=>{await refresh(signal)})}>重新检查交换箱</button>
   {status?.health.status==='not_configured'&&<form onSubmit={event=>{event.preventDefault();const currentPassword=password;setPassword('');void run('正在连接指定文件夹',async signal=>{await request('connect',{inboxRoot:root,currentPassword,consent:true},signal);await refresh(signal)})}}>
    <p>尚未连接交换箱。填写 WorkBuddy 将要写入的专用目录；只检查该目录内的完成批次。已有目录须为仅本人可读写。</p>
    <label>交换箱完整路径<input required value={root} onChange={event=>setRoot(event.target.value)} placeholder="/Users/你的用户名/WorkBuddy/鹊信交换箱"/></label>
    <label>当前账号密码<input required type="password" autoComplete="current-password" value={password} onChange={event=>setPassword(event.target.value)}/></label>
    <button className="btn primary" disabled={!!working}>授权连接这个文件夹</button>
   </form>}
   {status?.health.error&&status.health.status!=='not_configured'&&<p role="alert">{status.health.error.message}</p>}
   {status&&status.health.status!=='not_configured'&&<details><summary>给 WorkBuddy 的交接信息</summary><p>空间标识：{status.scope.spaceId}</p><p>按项目内的 WorkBuddy 文件夹任务模板导出，完成批次放在交换箱的 {status.scope.spaceId}/ready/ 下。鹊信不会直接操控 WorkBuddy 或微信。</p></details>}
   {status?.batches.map(batch=><article className="wb-batch" key={batch.batchId} aria-label={`聊天批次 ${batch.batchId}`}>
    <strong>{batch.summary?.participants.map(person=>person.label).join(' 与 ')||'聊天批次'}</strong><small>{labels[batch.status]??batch.status} · {batch.batchId}</small>
    {batch.summary&&<p>{batch.summary.range.from} 至 {batch.summary.range.to}<br/>{batch.counts?.messages} 条消息 · {batch.counts?.media} 个图片文件</p>}
    {batch.status==='completed'?<small>已建立私人归档 · 新增 {batch.receipt?.added??0} 条</small>:batch.status==='failed'?<><p role="alert">{batch.error?.message??'批次校验失败'}</p><button className="btn secondary" disabled={!!working} onClick={()=>void run('正在重新检查修复后的文件',async signal=>{setAllow(value=>value.filter(id=>id!==approvalKey(batch)));await request('retry',{batchId:batch.batchId},signal);await refresh(signal)})}>文件修复后重新检查</button></>:<>
     <label className="wb-check"><input type="checkbox" checked={allow.includes(approvalKey(batch))} disabled={!!working} onChange={event=>setAllow(value=>event.target.checked?[...value,approvalKey(batch)]:value.filter(id=>id!==approvalKey(batch)))}/><span>我确认读取上述范围，建立本机私人归档。此授权不包含向模型发送。</span></label>
     <button className="btn primary" disabled={!!working||!allow.includes(approvalKey(batch))||!batch.digest} onClick={()=>receive(batch)}>确认读取并归档</button>
    </>}
   </article>)}
   {status&&status.health.status!=='not_configured'&&!status.batches.length&&<p>暂未发现完成批次。可以让 WorkBuddy 按任务模板导出后，再检查。</p>}
   {!!status?.stats.messages&&<form onSubmit={event=>{event.preventDefault();void run('正在本机检索聊天',signal=>search(signal))}}>
    <strong>检索本机聊天 · {status.stats.messages} 条</strong>
    <label>选择聊天<select value={conversation} onChange={event=>{setConversation(event.target.value);setResult(null);setSelected([]);setPreview(null);setOriginal(null);setCandidates([])}}>{status.stats.conversations.map(row=><option key={row.conversationId} value={row.conversationId}>{row.conversationId} · {row.messages} 条</option>)}</select></label>
    <label>聊天关键词<input value={query} maxLength={200} onChange={event=>setQuery(event.target.value)} placeholder="例如：海边、喜欢、周末"/></label>
    <details><summary>按日期或发送者筛选</summary><label>开始日期<input type="date" value={from} onChange={event=>setFrom(event.target.value)}/></label><label>结束日期<input type="date" value={to} onChange={event=>setTo(event.target.value)}/></label><label>发送者标识<input value={sender} maxLength={128} onChange={event=>setSender(event.target.value)} placeholder="如 self 或 partner"/></label></details>
    <button className="btn secondary" disabled={!!working}>检索聊天</button>
   </form>}
   {result&&<div aria-label="聊天检索结果"><p>本页 {result.items.length} 条。最多选择 {Math.min(6,status?.model.maxSources??6)} 条整理；勾选不会发送。</p>
    {result.items.map(row=><article className="wb-excerpt" key={row.messageId}>
     <label className="wb-check"><input type="checkbox" aria-label={`选择消息 ${row.senderLabel} ${row.timestamp}`} checked={selected.some(item=>item.messageId===row.messageId)} disabled={!!working} onChange={event=>{setPreview(null);setSendConsent(false);setSelected(items=>event.target.checked?(items.length>=Math.min(6,status?.model.maxSources??6)?items:[...items,row]):items.filter(item=>item.messageId!==row.messageId))}}/><span>{row.senderLabel} · {stamp(row.timestamp)}</span></label>
     <blockquote>{row.snippet}{row.truncated?'…':''}</blockquote><small>批次 {row.provenance.batchId} · 消息 {row.provenance.sequence}{row.mediaCount?` · 含 ${row.mediaCount} 张图片（未发送）`:''}</small>
     <button className="text-link" disabled={!!working} onClick={()=>void run('正在读取这条原文',async signal=>{const value=await request<ChatOriginal|null>('message',{conversationId:row.conversationId,messageId:row.messageId},signal);if(!signal.aborted){setOriginal(value);if(!value)setNotice('原文已不可用。')}})}>查看这条原文</button>
    </article>)}
    {result.nextCursor&&<button className="text-link" disabled={!!working} onClick={()=>void run('正在读取下一页',signal=>search(signal,result.nextCursor!))}>下一页聊天</button>}
    <button className="btn primary" disabled={!!working||!selected.length} onClick={()=>void run('正在准备资料范围',prepare)}>整理所选 {selected.length} 条片段</button>
   </div>}
   {original&&<section className="wb-original" aria-label="聊天原文"><header><strong>{original.senderLabel} · {stamp(original.timestamp)}</strong><button className="text-link" onClick={()=>setOriginal(null)}>关闭原文</button></header><blockquote>{original.text}</blockquote><small>{original.sources.map(source=>`${source.batchId} · ${source.chunkFile} 第 ${source.chunkLine} 行`).join('；')}</small></section>}
   {preview&&<section className="wb-preview" aria-label="聊天资料发送确认"><strong>先确认这次整理范围</strong><p>以下是将使用的完整片段（每条最多 1,000 字），不含其他聊天、图片或历史对话。</p>{preview.lines.map(line=><blockquote key={line.line}>{line.text}</blockquote>)}<p>外部服务：{preview.model.enabled?`${preview.model.provider} · ${preview.model.model}`:'未配置'}</p>
    <button className="btn secondary" disabled={!!working} onClick={()=>organize('local')}>只在本机整理</button>
    {preview.model.enabled&&<><label className="wb-check"><input type="checkbox" checked={sendConsent} onChange={event=>setSendConsent(event.target.checked)}/><span>我同意仅本次将以上片段发送给所列模型服务。</span></label><button className="btn primary" disabled={!!working||!sendConsent} onClick={()=>organize('model')}>确认发送这 {preview.lines.length} 条片段</button></>}
    <button className="text-link" onClick={()=>{setPreview(null);setSendConsent(false)}}>取消这次整理</button>
   </section>}
   {candidates.map(candidate=>{const saved=store.records.some(row=>row.id===candidate.id);return <article className="wb-candidate" key={candidate.id} aria-label="聊天候选">
    <strong>{saved?'已保存为私人记录':'待你核对的候选'}</strong>
    <label>候选类型<select value={candidate.kind} disabled={saved} onChange={event=>updateCandidate(candidate.id,{kind:event.target.value as ChatCandidate['kind']})}>{['回忆','心愿','偏好','计划'].map(kind=><option key={kind}>{kind}</option>)}</select></label>
    <label>候选标题<input value={candidate.title} maxLength={160} disabled={saved} onChange={event=>updateCandidate(candidate.id,{title:event.target.value})}/></label>
    <label>候选内容<textarea rows={4} value={candidate.body} maxLength={4000} disabled={saved} onChange={event=>updateCandidate(candidate.id,{body:event.target.value})}/></label>
    <label>候选日期<input type="date" value={candidate.date} disabled={saved} onChange={event=>updateCandidate(candidate.id,{date:event.target.value})}/></label>
    <details><summary>核对原文与来源</summary><blockquote>{candidate.excerpt.text}</blockquote><small>{stamp(candidate.excerpt.timestamp)} · 批次 {candidate.excerpt.source.batchId} · {candidate.excerpt.source.chunkFile} 第 {candidate.excerpt.source.chunkLine} 行</small></details>
    {!saved&&<><p>只保存这一条及引用片段，保存在当前账号的浏览器资料库。默认私密，计划类候选不会自动创建日程。</p><button className="btn primary" disabled={!!working} onClick={()=>save(candidate)}>确认保存为私人记录</button><button className="text-link" onClick={()=>setCandidates(items=>items.filter(item=>item.id!==candidate.id))}>忽略这条</button></>}
   </article>})}
  </>}
  {working&&<div role="status" className="wb-progress"><span>{working}…</span><button className="text-link" onClick={()=>controller.current?.abort()}>停止本次操作</button></div>}
 </section>
 return{panel,handleCommand,reset,working}
}
