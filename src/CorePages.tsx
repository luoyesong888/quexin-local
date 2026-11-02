import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { PageProps, PlanItem, RecordItem, RecordKind } from './domain'
import { extractCandidates, exportMuseum, makeId, today } from './data'
import { formalCloud } from './cloud-client'
import { Empty, Icon, Modal } from './ui'
import { importLines,jsonMessagesToText,csvMessagesToText,htmlMessagesToText,importFilePolicy,mapSpeaker,provenanceLabel,type RecordProvenance } from './import-source'
import { RecordSource } from './RecordSource'
import {generateModelCandidates,recognizeImage,transcribeAudio} from './model-assistant'
import {recurrenceDates,recurrenceLabel,validTimeZone} from '../shared/reminders.mjs'
import {notificationPermission,requestReminderPermission} from './reminder-engine'
import './core-pages.css'

const recordKinds: RecordKind[] = ['回忆', '心愿', '计划', '偏好']
const planKinds: PlanItem['kind'][] = ['心愿', '计划', '待办', '提醒', '纪念日']
const sampleImages:Record<string,string>={'memory-coast':'/assets/coast.jpg','memory-cafe':'/assets/cafe.jpg','memory-mountain':'/assets/mountain.jpg'}
const fmtDate = (value: string) => value ? new Date(`${value}T12:00:00`).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }) : '时间待补充'
const fingerprint = (item: RecordItem) => `${item.kind}|${item.date}|${item.body.replace(/\s/g, '').trim()}`

function newRecord(source = ''): RecordItem {
  return { id: makeId(), title: '', body: '', date: today(), kind: '回忆', source, status: 'pending' }
}

function readFile(file: File, image = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('文件读取失败，请重新选择。'))
    if (image) reader.readAsDataURL(file)
    else reader.readAsText(file)
  })
}

function RecordEditor({ item, onClose, onSave, notify }: { item: RecordItem; onClose: () => void; onSave: (item: RecordItem) => void; notify: PageProps['notify'] }) {
  const [draft, setDraft] = useState<RecordItem>({ ...item })
  const [imageBusy, setImageBusy] = useState(false)
  const [imageMode,setImageMode]=useState<'local'|'shared'|'private'>(item.mediaScope??'local')
  const removeUploaded=async(mediaId:string)=>{const result=await formalCloud.deleteMedia(mediaId);if(!result.ok)notify(result.error.message)}
  async function imageSelected(file?: File) {
    if (!file) return
    const allowed=imageMode==='local'?['image/jpeg','image/png','image/webp','image/gif']:['image/jpeg','image/png','image/webp']
    if(!allowed.includes(file.type)){notify(imageMode==='local'?'请选择 JPG、PNG、WebP 或 GIF 图片。':'安全媒体支持 JPG、PNG 或 WebP。');return}
    if(file.size>(imageMode==='local'?2:10)*1024*1024){notify(imageMode==='local'?'本机预览图片需小于 2 MB。':'安全媒体图片需小于 10 MB。');return}
    setImageBusy(true)
    try {
      if(imageMode==='local'){
        const image=await readFile(file,true)
        if(draft.mediaId&&draft.mediaId!==item.mediaId)await removeUploaded(draft.mediaId)
        setDraft(value=>({...value,image,imageThumbnail:undefined,mediaId:undefined,mediaScope:undefined}));return
      }
      const session=await formalCloud.getSession();if(!session.ok||!session.data)throw new Error('请先在“系统 → 双人同步实验室”登录正式账号。')
      const current=await formalCloud.getCurrentSpace();if(!current.ok||!current.data)throw new Error('请先创建或加入正式情侣空间。')
      const scope=draft.sensitive?'private':imageMode
      const uploaded=await formalCloud.uploadImage(current.data.space.id,file,scope,{entityType:'record',entityId:item.id});if(!uploaded.ok)throw new Error(uploaded.error.message)
      if(draft.mediaId&&draft.mediaId!==item.mediaId)await removeUploaded(draft.mediaId)
      setImageMode(scope);setDraft(value=>({...value,mediaId:uploaded.data.mediaId,mediaScope:scope,image:formalCloud.mediaUrl(uploaded.data.privateUrl),imageThumbnail:formalCloud.mediaUrl(uploaded.data.thumbnailUrl),sensitive:scope==='private'?true:value.sensitive}))
      notify(scope==='shared'?'照片已安全上传，伴侣登录后也可查看。':'私人记录的照片已按仅自己保存。')
    }
    catch(cause) { notify(cause instanceof Error?cause.message:'图片读取失败，请重试。') }
    finally { setImageBusy(false) }
  }
  const closeEditor=()=>{if(draft.mediaId&&draft.mediaId!==item.mediaId)void removeUploaded(draft.mediaId);onClose()}
  const removeImage=()=>{if(draft.mediaId&&draft.mediaId!==item.mediaId)void removeUploaded(draft.mediaId);setDraft(value=>({...value,image:undefined,imageThumbnail:undefined,mediaId:undefined,mediaScope:undefined}))}
  function submit(event: FormEvent) {
    event.preventDefault()
    if (!draft.title.trim() || !draft.body.trim()) return
    onSave({ ...draft, title: draft.title.trim(), body: draft.body.trim(), source: draft.source.trim() || '本人手动记录', entityVersion: (draft.entityVersion ?? 0) + 1, expectedVersion: draft.entityVersion ?? 0 })
    if(item.mediaId&&item.mediaId!==draft.mediaId)void removeUploaded(item.mediaId)
  }
  return <Modal title={item.title ? '编辑这条记录' : '写下值得记住的事'} onClose={closeEditor} wide>
    <form className="core-editor" onSubmit={submit}>
      <label className="field">标题<input autoFocus required maxLength={80} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} placeholder="给这段时光起个名字" /></label>
      <div className="form-grid"><label className="field">记录类型<select value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value as RecordKind })}>{recordKinds.map(kind => <option key={kind}>{kind}</option>)}</select></label><label className="field">日期{draft.kind === '心愿' || draft.kind === '偏好' ? '（可选）' : ''}<input type="date" required={draft.kind === '回忆' || draft.kind === '计划'} value={draft.date} onChange={e => setDraft({ ...draft, date: e.target.value })} /></label></div>
      <label className="field">内容<textarea required rows={5} maxLength={12000} value={draft.body} onChange={e => setDraft({ ...draft, body: e.target.value })} placeholder="那一天，发生了什么？" /></label>
      <label className="field">原文或来源<textarea rows={3} maxLength={30000} value={draft.source} onChange={e => setDraft({ ...draft, source: e.target.value })} placeholder="手动记录，或粘贴对应的原始片段" /></label>
      <div className="core-image-mode"><span>照片保存位置</span><div className="segmented"><button type="button" className={imageMode==='local'?'active':''} onClick={()=>setImageMode('local')}>仅当前浏览器</button><button type="button" className={imageMode==='shared'?'active':''} onClick={()=>setImageMode('shared')}>安全共享</button><button type="button" className={imageMode==='private'?'active':''} onClick={()=>setImageMode('private')}>仅自己</button></div><small>{imageMode==='local'?'以本机预览保存，不上传服务端。':imageMode==='shared'?'重新编码后保存到正式本地空间，双方登录可见。':'重新编码后保存，伴侣无法读取，整条记录不参与同步。'}</small></div>
      <div className="core-upload-row"><label className="core-upload-label"><Icon name="image" size={18} /><span>{imageBusy ? '正在安全处理…' : '添加照片'}<small>{imageMode==='local'?'JPG / PNG / WebP / GIF，最大 2 MB':'JPG / PNG / WebP，最大 10 MB'}</small></span><input type="file" accept={imageMode==='local'?'image/jpeg,image/png,image/webp,image/gif':'image/jpeg,image/png,image/webp'} disabled={imageBusy} onChange={e => { void imageSelected(e.target.files?.[0]); e.target.value = '' }} /></label>{draft.image ? <div className="core-upload-preview"><img src={draft.imageThumbnail??draft.image} alt="所选照片" /><button type="button" className="btn small" onClick={removeImage}>移除照片</button></div>:sampleImages[item.id]&&<button type="button" className="btn small secondary" onClick={()=>{setImageMode('local');setDraft(value=>({...value,image:sampleImages[item.id]}))}}>恢复示例配图</button>}</div>
      <label className="core-checkbox"><input type="checkbox" checked={Boolean(draft.sensitive)} disabled={draft.mediaScope==='private'} onChange={e => setDraft({ ...draft, sensitive: e.target.checked })} /><span>包含私人或敏感内容<small>{draft.mediaScope==='private'?'“仅自己”照片会强制整条记录保持私人。':'私人记录不再排队发送；此前已共享的照片和导出副本仍需另行处理。'}</small></span></label>
      <div className="core-modal-actions"><button type="button" className="btn secondary" onClick={closeEditor}>取消</button><button type="submit" className="btn primary" disabled={imageBusy}>保存记录</button></div>
    </form>
  </Modal>
}

export function MemoriesPage({ store, update, notify, intent }: PageProps) {
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('全部')
  const [view, setView] = useState<'grid' | 'timeline'>('grid')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState<RecordItem | null>(() => intent === 'new' ? newRecord() : null)
  const [deleting, setDeleting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const confirmed = store.records.filter(item => item.status === 'confirmed')
  const visible = useMemo(() => confirmed.filter(item => (kind === '全部' || item.kind === kind) && `${item.title} ${item.body} ${item.source}`.toLowerCase().includes(query.toLowerCase().trim())).sort((a, b) => b.date.localeCompare(a.date)), [confirmed, kind, query])
  const selected = confirmed.find(item => item.id === selectedId)
  function save(item: RecordItem) {
    update(value => ({ ...value, records: value.records.some(record => record.id === item.id) ? value.records.map(record => record.id === item.id ? { ...item, status: 'confirmed' } : record) : [{ ...item, status: 'confirmed' }, ...value.records] }), '回忆已保存在当前浏览器。')
    setEditing(null)
  }
  async function downloadMuseum() {
    setExporting(true)
    try { await exportMuseum(confirmed); notify('离线纪念馆已生成，请查看浏览器下载。') }
    catch { notify('导出失败，请稍后重试。') }
    finally { setExporting(false) }
  }
  function remove() {
    if (!selected) return
    update(value => ({ ...value, records: value.records.filter(item => item.id !== selected.id) }), '记录已删除，助手也不会再引用它。')
    if(selected.mediaId)void formalCloud.deleteMedia(selected.mediaId)
    setSelectedId(null); setDeleting(false)
  }
  return <div className="core-page">
    <section className="core-memory-intro"><div><span className="core-kicker">OUR LITTLE ARCHIVE</span><h2>日子很长，值得慢慢收藏。</h2><p>这里有 {confirmed.length} 条已确认的记录，每一条都有迹可循。</p></div><div className="core-intro-actions"><button className="btn secondary" disabled={!confirmed.length || exporting} onClick={() => void downloadMuseum()}><Icon name="download" size={16} />{exporting ? '正在导出…' : '导出纪念馆'}</button><button className="btn primary" onClick={() => setEditing(newRecord())}><Icon name="plus" size={16} />写一条回忆</button></div></section>
    <div className="toolbar core-memory-toolbar"><div className="core-filter-pills" aria-label="记录类型">{['全部', ...recordKinds].map(value => <button key={value} aria-pressed={kind === value} className={kind === value ? 'active' : ''} onClick={() => setKind(value)}>{value}</button>)}</div><div className="core-toolbar-right"><label className="core-search"><Icon name="search" size={16} /><input aria-label="搜索回忆" placeholder="找一段回忆…" value={query} onChange={e => setQuery(e.target.value)} />{query && <button aria-label="清空搜索" onClick={() => setQuery('')}>×</button>}</label><div className="segmented"><button className={view === 'grid' ? 'active' : ''} aria-pressed={view === 'grid'} onClick={() => setView('grid')}>照片墙</button><button className={view === 'timeline' ? 'active' : ''} aria-pressed={view === 'timeline'} onClick={() => setView('timeline')}>时间线</button></div></div></div>
    {visible.length ? <div className={`core-memory-collection core-${view}`}>{visible.map((item, index) => <button className={`core-memory-card core-memory-${index % 4}`} key={item.id} onClick={() => { setSelectedId(item.id); setDeleting(false) }}><div className="core-memory-art">{item.image ? <img src={item.imageThumbnail??item.image} alt={item.title} loading="lazy" /> : <div className="core-type-art"><Icon name={item.kind === '心愿' ? 'star' : item.kind === '偏好' ? 'heart' : item.kind === '计划' ? 'calendar' : 'book'} size={42} /><span>{item.kind === '回忆' ? '把这一刻，留在心里' : item.kind === '心愿' ? '一起期待，慢慢实现' : item.kind === '偏好' ? '因为在意，所以记得' : '下一站，也一起'}</span></div>}<span className="core-memory-kind">{item.kind}</span></div><div className="core-memory-copy"><time>{fmtDate(item.date)}</time><h3>{item.title}</h3><p>{item.body}</p><div className="core-memory-foot"><span><Icon name="link" size={13} />{item.source ? '查看原文来源' : '手动记录'}</span>{item.sensitive ? <span>仅自己</span> : <Icon name="arrow" size={16} />}</div></div></button>)}</div> : <Empty text={query || kind !== '全部' ? '还没有找到这段回忆，换个关键词试试。' : '我们的故事，从第一条记录开始。'} action={<button className="btn primary" onClick={() => setEditing(newRecord())}>写一条回忆</button>} />}
    {selected && !editing && <Modal title={selected.title} onClose={() => setSelectedId(null)} wide><article className="core-record-detail">{selected.image && <img className="core-detail-image" src={selected.image} alt={selected.title} />}<div className="core-detail-meta"><span className="tag">{selected.kind}</span><time>{fmtDate(selected.date)}</time>{selected.sensitive && <span className="tag">私人记录</span>}</div><p className="core-detail-body">{selected.body}</p><details className="core-source-detail"><summary>查看原文与来源</summary><RecordSource record={selected}/></details>{deleting ? <div className="core-delete-confirm" role="alert"><p>确定删除“{selected.title}”吗？删除后不会再出现在回忆和助手查询中，此操作无法撤销。</p><div><button className="btn secondary" onClick={() => setDeleting(false)}>保留记录</button><button className="btn danger" onClick={remove}>确认删除</button></div></div> : <div className="core-modal-actions"><button className="btn secondary" onClick={() => setDeleting(true)}>删除记录</button><button className="btn primary" onClick={() => setEditing(selected)}>编辑记录</button></div>}</article></Modal>}
    {editing && <RecordEditor item={editing} notify={notify} onClose={() => setEditing(null)} onSave={save} />}
  </div>
}

export function ImportPage({ store, setStore, update, notify, go, intent }: PageProps) {
  const restored=useRef(store.importDraft).current
  const [showRestored,setShowRestored]=useState(Boolean(restored))
  const [step, setStep] = useState<1|2|3|4>(restored?.step??1)
  const [tab, setTab] = useState<'text' | 'file' | 'wechat'>(() => restored?.tab??(intent === 'file' || intent === 'wechat' ? intent : 'text'))
  const [text, setText] = useState(restored?.text??'')
  const [baseDate, setBaseDate] = useState(restored?.baseDate??today())
  const [selfAlias, setSelfAlias] = useState(restored?.selfAlias??'我')
  const [partnerAlias, setPartnerAlias] = useState(restored?.partnerAlias??'对方')
  const [checkedLines, setCheckedLines] = useState<number[]>(restored?.checkedLines??[])
  const [batchIds, setBatchIds] = useState<string[]>(store.records.filter(item => item.status === 'pending').map(item => item.id))
  const [image, setImage] = useState<string | undefined>()
  const [fileName, setFileName] = useState(restored?.fileName??'')
  const [loading, setLoading] = useState(false)
  const [importError,setImportError]=useState('')
  const [sourceType,setSourceType]=useState<RecordProvenance['type']>(restored?.sourceType??'text')
  const [editing, setEditing] = useState<RecordItem | null>(null)
  const [sensitiveAllowed, setSensitiveAllowed] = useState<string[]>([])
  const [duplicateCount, setDuplicateCount] = useState<number | null>(null)
  const [modelBusy,setModelBusy]=useState(false)
  const modelController=useRef<AbortController|null>(null)
  const [selectedFile,setSelectedFile]=useState<File|null>(null),[audioUrl,setAudioUrl]=useState(''),[recognitionBusy,setRecognitionBusy]=useState(false)
  const recognitionController=useRef<AbortController|null>(null)
  useEffect(()=>()=>{modelController.current?.abort();recognitionController.current?.abort();if(audioUrl)URL.revokeObjectURL(audioUrl)},[audioUrl])
  useEffect(()=>{
    if(step>2)return
    const timer=window.setTimeout(()=>setStore(value=>{
      if(!text&&!fileName){if(!value.importDraft)return value;const {importDraft:_draft,...rest}=value;return rest as typeof value}
      const draft={step:step as 1|2,tab,text,baseDate,selfAlias,partnerAlias,checkedLines,fileName,sourceType,binaryRequired:Boolean(fileName&&['image-manual','image-ocr','audio-transcript'].includes(sourceType)),savedAt:new Date().toISOString()}
      const comparable={...draft,savedAt:value.importDraft?.savedAt??draft.savedAt}
      return JSON.stringify(value.importDraft)===JSON.stringify(comparable)?value:{...value,importDraft:draft}
    }),350)
    return()=>window.clearTimeout(timer)
  },[step,tab,text,baseDate,selfAlias,partnerAlias,checkedLines,fileName,sourceType,setStore])
  const lineRows=importLines(text)
  const lines = lineRows.map(row=>row.original.trim())
  const batch = store.records.filter(item => batchIds.includes(item.id))
  const saved = batch.filter(item => item.status === 'confirmed')
  const ignored = batch.filter(item => item.status === 'ignored')
  const pending = batch.filter(item => item.status === 'pending')
  const example = `我：${baseDate}，今天一起去湖边散步，拍到了很好看的晚霞。\n对方：下次想一起去海边，看一次日出。\n我：记住啦！你最近喜欢喝不加糖的拿铁。\n对方：周末去那家一直想去的书店吧，日期我们再确定。`
  const clearDraft=()=>setStore(value=>{if(!value.importDraft)return value;const {importDraft:_draft,...rest}=value;return rest as typeof value})
  function next() { if (!text.trim()) return; setCheckedLines(lines.map((_, index) => index)); setStep(2) }
  function selectedText() {
    return lines.filter((_, index) => checkedLines.includes(index)).map(line=>mapSpeaker(line,selfAlias,store.settings.selfName,partnerAlias,store.settings.partnerName)).join('\n')
  }
  async function importFile(file?: File) {
    if (!file) return
    const policy=importFilePolicy(file.name,file.type),isImage=policy.kind==='image',isAudio=policy.kind==='audio',isJSON=policy.kind==='json',isCSV=policy.kind==='csv',isHTML=policy.kind==='html'
    if(policy.kind==='unsupported'){notify('请选择 TXT、JSON、CSV、HTML、图片或录音文件。');return}
    const maximum=policy.maximum
    if(file.size>maximum){notify(isAudio?'录音需小于 25 MB。':isImage?'图片需小于 10 MB。':'文字文件需小于 2 MB。');return}
    setLoading(true)
    setImportError('')
    try {
      if(audioUrl){URL.revokeObjectURL(audioUrl);setAudioUrl('')}
      if (isImage) { const content=await readFile(file,true);setImage(content);setSelectedFile(file);setSourceType('image-manual'); setText(''); notify('图片已读取。可以发送到已配置的 OCR，也可以手动填写文字。') }
      else if(isAudio){setImage(undefined);setSelectedFile(file);setAudioUrl(URL.createObjectURL(file));setSourceType('audio-transcript');setText('');notify('录音已读取。发送到转写服务前仍需要你明确点击确认。')}
      else { const content=await readFile(file),parsed=isJSON?jsonMessagesToText(JSON.parse(content)):isCSV?csvMessagesToText(content):isHTML?htmlMessagesToText(content):content;if(parsed.length>100000)throw new Error('内容超过 10 万字，请分批导入。');setText(parsed);setSourceType(isJSON?'json':isCSV?'csv':isHTML?'html':'txt');setSelectedFile(null); setImage(undefined); notify('文件已读取，请核对内容。') }
      setFileName(file.name)
    } catch(cause) { setImportError(cause instanceof SyntaxError?'JSON 格式有误，请检查文件。':cause instanceof Error?cause.message:'文件无法解析。');notify('文件读取失败，当前内容没有被替换。') }
    finally { setLoading(false) }
  }
  async function recognizeSelected(){
    if(!selectedFile)return;const controller=new AbortController();recognitionController.current=controller;setRecognitionBusy(true);setImportError('')
    try{const result=sourceType==='audio-transcript'?await transcribeAudio(selectedFile,controller.signal):await recognizeImage(selectedFile,controller.signal);setText(result.text);setSourceType(sourceType==='audio-transcript'?'audio-transcript':'image-ocr');notify(sourceType==='audio-transcript'?'录音转写完成，请人工核对人物和文字。':'OCR 完成，请人工核对图片文字。')}
    catch(error){if(controller.signal.aborted)notify('识别已取消，文件仍保留在当前页面。');else{const message=error instanceof Error?error.message:'识别失败';setImportError(`${message}。你仍可以手动填写文字。`)}}
    finally{if(recognitionController.current===controller)recognitionController.current=null;setRecognitionBusy(false)}
  }
  function finishCandidates(generated:RecordItem[],label:string) {
    clearDraft()
    const existing = new Set(store.records.filter(item => item.status !== 'ignored').map(fingerprint))
    const fresh = generated.filter(item => { const key = fingerprint(item); if (existing.has(key)) return false; existing.add(key); return true })
    const skipped = generated.length - fresh.length
    setDuplicateCount(skipped)
    if (!fresh.length) { setBatchIds([]);notify(generated.length ? '这些内容已经存在，没有重复添加。' : '没有识别到可整理的内容，你可以手动新建候选。'); setStep(3); return }
    update(value => ({ ...value, records: [...fresh, ...value.records] }), `已生成 ${fresh.length} 条${label}候选${skipped ? `，跳过 ${skipped} 条重复内容` : ''}，请逐条核对。`)
    setBatchIds(fresh.map(item => item.id)); setSensitiveAllowed([]); setStep(3)
  }
  async function generate() {
    const content = selectedText()
    if (!content.trim()) { notify('请至少选择一条内容。'); return }
    const batchId=makeId(),importedAt=new Date().toISOString(),label=fileName?`${fileName}（整理文本）`:sourceType==='sample'?'虚构样例（可编辑）':'粘贴文字'
    const selectedRows=lineRows.filter((_,index)=>checkedLines.includes(index))
    if (store.settings.aiMode === 'off') { clearDraft();setEditing({ ...newRecord(content), date: baseDate, image,provenance:{batchId,type:sourceType,label,line:selectedRows[0].line,original:selectedRows.map(row=>row.original).join('\n'),mapped:content,importedAt,baseDate} }); return }
    const local=()=>selectedRows.flatMap((row,index)=>{
      const mapped=mapSpeaker(row.original.trim(),selfAlias,store.settings.selfName,partnerAlias,store.settings.partnerName)
      return extractCandidates(mapped,baseDate).map(item=>({...item,source:row.original,provenance:{batchId,type:sourceType,label,line:row.line,original:row.original,mapped,importedAt,baseDate},image:index===0?image:undefined}))
    })
    if(store.settings.aiMode==='model'&&store.settings.aiModelConsent){
      const controller=new AbortController();modelController.current=controller;setModelBusy(true)
      try{
        const mappedRows=selectedRows.map(row=>({line:row.line,text:mapSpeaker(row.original.trim(),selfAlias,store.settings.selfName,partnerAlias,store.settings.partnerName)}))
        const result=await generateModelCandidates({consent:true,baseDate,selfName:store.settings.selfName,partnerName:store.settings.partnerName,lines:mappedRows},controller.signal)
        const generated=result.candidates.map((item,index)=>{
          const row=selectedRows.find(source=>source.line===item.sourceLine)!,mapped=mapSpeaker(row.original.trim(),selfAlias,store.settings.selfName,partnerAlias,store.settings.partnerName)
          const dateValid=!item.date||(/^\d{4}-\d{2}-\d{2}$/.test(item.date)&&!Number.isNaN(Date.parse(item.date+'T12:00:00')))
          const date=dateValid?item.date:'',localSensitive=extractCandidates(mapped,baseDate).some(candidate=>candidate.sensitive)
          return{id:makeId(),title:item.title,body:item.body,date,kind:item.kind,source:row.original,status:'pending' as const,sensitive:item.sensitive||localSensitive,needsDateReview:!date&&(item.kind==='回忆'||item.kind==='计划'),provenance:{batchId,type:sourceType,label,line:row.line,original:row.original,mapped,importedAt,baseDate},image:index===0?image:undefined}
        })
        finishCandidates(generated,'真实模型')
        return
      }catch(error){
        if(controller.signal.aborted){notify('已取消模型整理，没有生成候选。');return}
        notify(`${error instanceof Error?error.message:'模型整理失败'}，已改用本地规则生成候选。`)
      }finally{if(modelController.current===controller)modelController.current=null;setModelBusy(false)}
    }
    finishCandidates(local(),'本地规则')
  }
  function saveCandidate(item: RecordItem) {
    if (!item.title.trim() || !item.body.trim() || ((item.kind === '回忆' || item.kind === '计划') && !item.date)) { notify('请先补充标题、内容，以及回忆或计划的具体日期。'); setEditing(item); return }
    if (item.sensitive && !sensitiveAllowed.includes(item.id)) { notify('这条候选含私人内容，请先勾选确认。'); return }
    if (store.records.some(record => record.id !== item.id && record.status === 'confirmed' && fingerprint(record) === fingerprint(item))) { notify('已有相同的正式记录，请忽略这条重复候选。'); return }
    update(value => {
      const planId = `record-${item.id}`
      const addPlan = !item.sensitive && (item.kind === '心愿' || item.kind === '计划') && !value.plans.some(plan => plan.id === planId)
      const plan: PlanItem = { id: planId,sourceRecordId:item.id, title: item.title, date: item.date, time: '', kind: item.kind === '心愿' ? '心愿' : '计划', status: item.kind === '计划' && /取消/.test(item.body) ? 'cancelled' : 'todo' }
      return { ...value, records: value.records.map(record => record.id === item.id ? { ...record, status: 'confirmed',needsDateReview:false } : record), plans: addPlan ? [...value.plans, plan] : value.plans }
    }, !item.sensitive&&(item.kind === '心愿' || item.kind === '计划') ? '已确认保存，并加入日历与心愿。' : '已确认保存，可在回忆中查看。')
  }
  function editSave(item: RecordItem) {
    const exists = store.records.some(record => record.id === item.id)
    update(value => ({ ...value, records: exists ? value.records.map(record => record.id === item.id ? item : record) : [{ ...item, status: 'pending' }, ...value.records] }), '候选已保存，确认后才会成为正式记录。')
    if (!batchIds.includes(item.id)) setBatchIds(ids => [...ids, item.id])
    setEditing(null); setStep(3)
  }
  function deduplicate() {
    const seen = new Set(store.records.filter(item => item.status === 'confirmed').map(fingerprint))
    const ids: string[] = []
    pending.forEach(item => { const key = fingerprint(item); if (seen.has(key)) ids.push(item.id); else seen.add(key) })
    setDuplicateCount(ids.length)
    if (ids.length) update(value => ({ ...value, records: value.records.map(item => ids.includes(item.id) ? { ...item, status: 'ignored' } : item) }), `已将 ${ids.length} 条重复候选移入忽略区，可撤销。`)
    else notify('检查完成：本批次没有发现重复内容。')
  }
  return <div className="core-page">
    <div className="core-import-stepper" aria-label={`导入流程，第 ${step} 步`}>{['选择内容', '确认人物与范围', '核对候选', '完成保存'].map((label, index) => <div key={label} className={step === index + 1 ? 'active' : step > index + 1 ? 'done' : ''}><span>{step > index + 1 ? '✓' : `0${index + 1}`}</span><strong>{label}</strong></div>)}</div>
    {importError&&<p className="core-info-strip" role="alert">{importError}</p>}
    {showRestored&&store.importDraft&&<div className="core-info-strip" role="status"><Icon name="refresh" size={18}/><div><strong>已恢复未完成的导入</strong><p>保存于 {new Date(store.importDraft.savedAt).toLocaleString('zh-CN')}{store.importDraft.binaryRequired?'；图片或音频文件不会写入草稿，请重新选择文件后再识别。':''}</p><button className="core-text-button" onClick={()=>{setShowRestored(false);clearDraft();setStep(1);setText('');setFileName('');setSourceType('text');setCheckedLines([])}}>放弃这份草稿</button></div></div>}
    <p className="core-info-strip">{store.settings.aiMode==='model'?'已选择真实模型；只有你在下一步点击生成时，所选文字才会发送。':'当前使用本地规则整理，不发送外部模型。'} OCR 文字由你填写，微信仅支持主动导入。每条候选保留来源与行号，仍需逐条确认。</p>
    {step === 1 && <section className="panel core-import-start"><div className="core-import-title"><span className="core-kicker">A LITTLE MORE ABOUT US</span><h2>从一段聊天，开始整理我们的故事。</h2><p>由你选择内容，由你确认保存。原始资料保留在当前浏览器。</p></div><div className="core-input-tabs" role="tablist" aria-label="导入方式">{([{ id: 'text', icon: 'message', title: '粘贴文字', desc: '聊天、随手记，都可以' }, { id: 'file', icon: 'upload', title: '上传文件', desc: 'TXT、JSON 或聊天截图' }, { id: 'wechat', icon: 'message', title: '微信样例', desc: '体验主动导入的流程' }] as const).map(item => <button role="tab" aria-selected={tab === item.id} key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}><Icon name={item.icon} size={22} /><span><strong>{item.title}</strong><small>{item.desc}</small></span></button>)}</div>
      {tab === 'file' && <><label className="core-file-drop"><Icon name="upload" size={25} /><strong>{loading ? '正在读取文件…' : fileName || '点击选择本地文件'}</strong><span>文字 2 MB · 图片 10 MB · 录音 25 MB；识别前不会发送</span><input aria-label="选择导入文件" type="file" accept=".txt,.json,.csv,.html,.htm,image/jpeg,image/png,image/webp,image/gif,audio/*,video/mp4,.mp3,.m4a,.wav,.webm,.ogg,.flac" disabled={loading||recognitionBusy} onChange={e => { void importFile(e.target.files?.[0]); e.target.value = '' }} /></label>{image && <div className="core-import-image"><img src={image} alt="导入的聊天截图" /><p>{sourceType==='image-ocr'?'OCR 结果已经填入下方，必须人工校正后再生成候选。':'图片只在当前页面预览；可以发送到配置的识别模型，或手动填写文字。'}</p></div>}{audioUrl&&<div className="core-import-audio"><audio controls src={audioUrl}/><p>录音不会写入导入草稿。转写前请确认文件名与大小；结果仍需人工校正。</p></div>}{selectedFile&&(image||audioUrl)&&<div className="core-recognition-consent"><p>将发送 <strong>{selectedFile.name}</strong>（{(selectedFile.size/1024/1024).toFixed(2)} MB）到服务端配置的{audioUrl?'录音转写':'图片识别'}服务。不会发送其他记录。</p><div className="core-inline"><button className="btn secondary" disabled={recognitionBusy} onClick={()=>void recognizeSelected()}>{recognitionBusy?'正在识别…':audioUrl?'同意发送并转写':'同意发送并识别文字'}</button>{recognitionBusy&&<button className="btn secondary" onClick={()=>recognitionController.current?.abort()}>取消识别</button>}</div></div>}</>}
      {tab === 'wechat' && <div className="core-info-strip"><Icon name="info" size={18} /><div><strong>微信连接为演示模式</strong><p>这里使用虚构聊天，不会连接或读取你的微信。点击下方按钮载入可编辑样例。</p><button className="btn secondary small" onClick={() => { setText(example);setSourceType('sample');setImportError(''); setImage(undefined); setFileName(''); notify('已载入虚构微信聊天样例。') }}>载入微信样例</button></div></div>}
      <label className="field core-import-text">{audioUrl?'录音转写文字':image?'图片中的文字':'想整理的内容'}<textarea data-testid="import-text" rows={9} maxLength={100000} value={text} onChange={e => setText(e.target.value)} placeholder={'我：今天一起去湖边散步，晚霞很好看。\n对方：下次想一起去海边，看一次日出。'} /></label><div className="core-import-footer"><div><button className="core-text-button" onClick={() => { setText(example);setSourceType('sample');setImportError('');setFileName(''); setImage(undefined) }}>试用一段虚构聊天</button><small>{lines.length} 段内容 · {text.length} 字</small></div><button className="btn primary" disabled={!text.trim() || loading} onClick={next}>下一步，确认范围 <Icon name="arrow" size={16} /></button></div>{store.records.some(item => item.status === 'pending') && <button className="core-resume" onClick={() => { setBatchIds(store.records.filter(item => item.status === 'pending').map(item => item.id)); setStep(3) }}>继续核对已有的 {store.records.filter(item => item.status === 'pending').length} 条候选 →</button>}</section>}
    {step === 2 && <div className="core-mapping-grid"><section className="panel core-mapping-panel"><div className="panel-heading"><h2>人物与时间</h2><span className="tag">先核对，再整理</span></div><p className="muted">只替换行首的人物标识，不猜测未注明的人物和具体安排。</p><div className="form-grid"><label className="field">“{store.settings.selfName}”在原文中的称呼<input value={selfAlias} onChange={e => setSelfAlias(e.target.value)} placeholder="例如：我" /></label><label className="field">“{store.settings.partnerName}”在原文中的称呼<input value={partnerAlias} onChange={e => setPartnerAlias(e.target.value)} placeholder="例如：对方" /></label></div><label className="field">这段聊天的基准日期<input type="date" required value={baseDate} onChange={e => setBaseDate(e.target.value)} /></label><div className="core-info-strip"><Icon name="info" size={18} /><p>{store.settings.aiMode==='off'?'自动整理已关闭，下一步手动填写候选。':store.settings.aiMode==='model'&&store.settings.aiModelConsent?`点击生成后，将把所选 ${checkedLines.length} 行文字、人物称呼和基准日期发送到配置的模型服务。原图不会发送。`:'当前使用本地规则，不调用外部模型。'}</p></div></section><section className="panel core-scope-panel"><div className="panel-heading"><h2>选择整理范围</h2><button className="core-text-button" onClick={() => setCheckedLines(checkedLines.length === lines.length ? [] : lines.map((_, index) => index))}>{checkedLines.length === lines.length ? '取消全选' : '选择全部'}</button></div><div className="core-scope-list">{lines.map((line, index) => <label key={index}><input type="checkbox" checked={checkedLines.includes(index)} onChange={e => setCheckedLines(values => e.target.checked ? [...values, index] : values.filter(value => value !== index))} /><span><small>原文 {String(index + 1).padStart(2, '0')}</small>{line}</span></label>)}</div><div className="core-import-footer"><span className="muted">已选 {checkedLines.length} / {lines.length} 段</span><div className="core-inline"><button className="btn secondary" onClick={() => setStep(1)}>返回</button><button className="btn primary" disabled={!checkedLines.length || !baseDate || modelBusy} onClick={()=>void generate()}>{modelBusy?'模型正在整理…':store.settings.aiMode==='off'?'手动创建候选':store.settings.aiMode==='model'?'发送所选文字并生成':'生成候选'}</button>{modelBusy&&<button className="btn secondary" onClick={()=>modelController.current?.abort()}>取消模型整理</button>}</div></div></section></div>}
    {step === 3 && <><div className="core-candidate-heading"><div><h2>这些片段，值得留下吗？</h2><p>确认后的记录才会出现在回忆和助手查询中。</p></div><div className="core-inline"><button className="btn secondary" onClick={deduplicate}><Icon name="search" size={16} />检查重复</button><button className="btn secondary" onClick={() => setEditing(newRecord(selectedText()))}><Icon name="plus" size={16} />手动添加</button></div></div>{duplicateCount !== null && <p className="core-dedup-note" role="status">最近一次检查：{duplicateCount ? `发现 ${duplicateCount} 条重复内容，已跳过或移入忽略区。` : '未发现重复内容。'}</p>}<div className="core-candidate-grid">{batch.filter(item => item.status !== 'ignored').map(item => <article aria-label={item.title} className={`panel core-candidate-card ${item.status === 'confirmed' ? 'is-confirmed' : ''}`} key={item.id}><div className="core-candidate-meta"><span className="tag">{item.kind}</span><time>{fmtDate(item.date)}</time></div><h3>{item.title}</h3><small className="muted">{provenanceLabel(item.provenance)}</small><p>{item.body}</p>{item.needsDateReview&&<p className="core-date-review">日期需要核对；回忆和计划请先补充具体日期，心愿和偏好可暂不填写。</p>}<details className="core-source-detail"><summary><Icon name="link" size={14} /> 查看原文依据</summary><RecordSource record={item}/></details>{item.status === 'pending' && item.sensitive && <label className="core-checkbox core-sensitive"><input type="checkbox" checked={sensitiveAllowed.includes(item.id)} onChange={e => setSensitiveAllowed(ids => e.target.checked ? [...ids, item.id] : ids.filter(id => id !== item.id))} /><span>我确认将这条私人内容保存在本机。</span></label>}<div className="core-candidate-actions">{item.status === 'confirmed' ? <span className="core-saved-mark"><Icon name="check" size={16} />已保存为正式记录</span> : <><button className="core-text-button" onClick={() => setEditing(item)}>修改</button><button className="core-text-button" onClick={() => update(value => ({ ...value, records: value.records.map(record => record.id === item.id ? { ...record, status: 'ignored' } : record) }), '已忽略，可以在本批次下方撤销。')}>忽略</button><button className="btn primary small" disabled={Boolean(item.sensitive && !sensitiveAllowed.includes(item.id))} onClick={() => saveCandidate(item)}>确认保存</button></>}</div></article>)}</div>{!batch.length && <Empty text="还没有候选。可以返回选择内容，或手动写下第一条。" action={<button className="btn secondary" onClick={() => setStep(1)}>选择内容</button>} />}{ignored.length > 0 && <details className="core-ignored"><summary>已忽略 {ignored.length} 条 · 可撤销</summary>{ignored.map(item => <div key={item.id}><span>{item.title}</span><button className="core-text-button" onClick={() => update(value => ({ ...value, records: value.records.map(record => record.id === item.id ? { ...record, status: 'pending' } : record) }), '候选已恢复，等待确认。')}>撤销忽略</button></div>)}</details>}<div className="panel core-batch-footer"><div><strong>已确认 {saved.length} 条</strong><small>{pending.length} 条待核对 · {ignored.length} 条已忽略</small></div><div className="core-inline"><button className="btn secondary" onClick={() => setStep(1)}>再导入一些</button><button className="btn primary" onClick={() => setStep(4)}>完成本批次 <Icon name="check" size={16} /></button></div></div></>}
    {step === 4 && <section className="panel core-import-complete"><div className="core-complete-icon"><Icon name="check" size={30} /></div><span className="core-kicker">A MOMENT, KEPT.</span><h2>{saved.length ? '又有一些日子，被好好记住了。' : '本次整理进度已保留。'}</h2><p>已保存 {saved.length} 条正式记录，忽略 {ignored.length} 条。{pending.length > 0 ? `还有 ${pending.length} 条候选待确认，下次可以继续。` : '每条记录都保留了原文来源。'}</p><div className="core-inline"><button className="btn secondary" onClick={() => setStep(pending.length ? 3 : 1)}>{pending.length ? '继续核对' : '再导入一些'}</button><button className="btn primary" onClick={() => go('memories')}>去看看回忆 <Icon name="arrow" size={16} /></button></div><small>已确认的非私密资料可参与已连接空间的同步；候选和私人记录不会自动共享。</small></section>}
    {editing && <RecordEditor item={editing} onClose={() => setEditing(null)} onSave={editSave} notify={notify} />}
  </div>
}

function PlanEditor({ item, onClose, onSave }: { item: PlanItem; onClose: () => void; onSave: (item: PlanItem) => void }) {
  const localZone=Intl.DateTimeFormat().resolvedOptions().timeZone||'Asia/Shanghai'
  const [draft,setDraft]=useState<PlanItem>({...item,timezone:item.timezone??localZone,recurrence:item.recurrence??'none',reminderMinutes:item.reminderMinutes??null,completedOccurrences:item.completedOccurrences??[]}),[error,setError]=useState('')
  const submit=(event:FormEvent)=>{event.preventDefault();setError('');if(!draft.title.trim())return;if(!validTimeZone(draft.timezone??'')){setError('请输入有效的 IANA 时区，例如 Asia/Shanghai');return}if(draft.recurrence!=='none'&&draft.recurrenceUntil&&draft.recurrenceUntil<draft.date){setError('重复结束日期不能早于开始日期');return}if(draft.reminderMinutes!==null&&!draft.time){setError('启用提醒前请先填写时间');return}onSave({...draft,title:draft.title.trim(),entityVersion:(draft.entityVersion??0)+1,expectedVersion:draft.entityVersion??0})}
  return <Modal title={item.title?'编辑这件事':'一起期待的下一件事'} onClose={onClose}><form className="core-editor" onSubmit={submit}><label className="field">想做什么<input autoFocus required maxLength={120} value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})} placeholder="例如：周末一起去逛书店"/></label><label className="field">类型<select value={draft.kind} onChange={e=>setDraft({...draft,kind:e.target.value as PlanItem['kind']})}>{planKinds.map(kind=><option key={kind}>{kind}</option>)}</select></label><div className="form-grid"><label className="field">日期{draft.kind==='心愿'?'（可选）':''}<input required={draft.kind!=='心愿'} type="date" value={draft.date} onChange={e=>setDraft({...draft,date:e.target.value})}/></label><label className="field">时间（可选）<input type="time" value={draft.time} onChange={e=>setDraft({...draft,time:e.target.value})}/></label></div><div className="form-grid"><label className="field">重复<select value={draft.recurrence} onChange={e=>setDraft({...draft,recurrence:e.target.value as PlanItem['recurrence']})}><option value="none">不重复</option><option value="daily">每天</option><option value="weekly">每周</option><option value="monthly">每月</option><option value="yearly">每年</option></select></label>{draft.recurrence!=='none'&&<label className="field">重复至（可选）<input type="date" min={draft.date} value={draft.recurrenceUntil??''} onChange={e=>setDraft({...draft,recurrenceUntil:e.target.value})}/></label>}</div><label className="field">时区<input list="quexin-timezones" value={draft.timezone??''} onChange={e=>setDraft({...draft,timezone:e.target.value})}/><datalist id="quexin-timezones"><option value="Asia/Shanghai"/><option value="Asia/Tokyo"/><option value="UTC"/><option value="Europe/London"/><option value="America/New_York"/></datalist></label><label className="field">提醒时间<select value={draft.reminderMinutes??''} onChange={e=>setDraft({...draft,reminderMinutes:e.target.value===''?null:Number(e.target.value)})}><option value="">不提醒</option><option value="0">准时</option><option value="10">提前 10 分钟</option><option value="30">提前 30 分钟</option><option value="60">提前 1 小时</option><option value="1440">提前 1 天</option></select></label>{error&&<p role="alert" className="core-info-strip">{error}</p>}<p className="core-info-strip">提醒会先显示在应用内；允许浏览器通知后，页面打开或重新可见时也会投递系统通知。浏览器被系统完全关闭时不保证精确定时。</p><div className="core-modal-actions"><button type="button" className="btn secondary" onClick={onClose}>取消</button><button type="submit" className="btn primary">保存安排</button></div></form></Modal>
}

export function PlannerPage({ store, update, notify, intent }: PageProps) {
  const currentDate = today()
  const localZone=Intl.DateTimeFormat().resolvedOptions().timeZone||'Asia/Shanghai'
  const [month, setMonth] = useState(currentDate.slice(0, 7))
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [filter, setFilter] = useState('全部')
  const [editing, setEditing] = useState<PlanItem | null>(() => intent === 'new' ? { id: makeId(), title: '', date: currentDate, time: '', kind: '计划', status: 'todo',timezone:localZone,recurrence:'none',reminderMinutes:null,completedOccurrences:[] } : null)
  const [cancelId, setCancelId] = useState<string | null>(null)
  const [memoryPlan, setMemoryPlan] = useState<PlanItem | null>(null)
  const [permission,setPermission]=useState(notificationPermission())
  const [year, monthNumber] = month.split('-').map(Number)
  const firstWeekday = (new Date(year, monthNumber - 1, 1).getDay() + 6) % 7
  const days = new Date(year, monthNumber, 0).getDate()
  const cellCount = Math.ceil((firstWeekday + days) / 7) * 7
  const occurs=(item:PlanItem,date:string)=>Boolean(recurrenceDates(item,date,date).length)
  const plans = store.plans.filter(item => (filter === '全部' || (filter === '已取消' ? item.status === 'cancelled' : item.kind === filter && item.status !== 'cancelled')) && (!selectedDate || occurs(item,selectedDate))).sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || a.time.localeCompare(b.time))
  const upcoming = store.plans.filter(item => item.status === 'todo')
  useEffect(()=>{
    document.querySelectorAll<HTMLButtonElement>('.core-calendar-grid button[aria-label]').forEach(button=>{
      const day=button.querySelector(':scope > span')?.textContent?.trim(),label=button.getAttribute('aria-label')
      if(day&&label&&!label.startsWith(`${day}日`))button.setAttribute('aria-label',`${day}日，${label}`)
    })
  },[month,store.plans])
  function moveMonth(delta: number) { const date = new Date(year, monthNumber - 1 + delta, 1); setMonth(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`); setSelectedDate(null) }
  function create() { setEditing({ id: makeId(), title: '', date: selectedDate || currentDate, time: '', kind: '计划', status: 'todo',timezone:localZone,recurrence:'none',reminderMinutes:null,completedOccurrences:[] }) }
  function save(item: PlanItem) { update(value => ({ ...value, plans: value.plans.some(plan => plan.id === item.id) ? value.plans.map(plan => plan.id === item.id ? item : plan) : [...value.plans, item] }), '安排已保存。'); setEditing(null) }
  function status(id: string, next: PlanItem['status']) { update(value => ({ ...value, plans: value.plans.map(plan => plan.id === id ? { ...plan, status: next } : plan) }), next === 'done' ? '已标记完成，可以把这件事写成回忆。' : next === 'cancelled' ? '已取消这次安排，原记录仍然保留。' : '已恢复为待完成。'); setCancelId(null) }
  function toggleOccurrence(item:PlanItem,date:string){const recurring=(item.recurrence??'none')!=='none';if(!recurring){status(item.id,item.status==='done'?'todo':'done');return}const done=item.completedOccurrences?.includes(date);update(value=>({...value,plans:value.plans.map(plan=>plan.id===item.id?{...plan,completedOccurrences:done?(plan.completedOccurrences??[]).filter(value=>value!==date):[...(plan.completedOccurrences??[]),date]}:plan)}),done?'这一次已恢复为待完成。':'这一次已标记完成，重复计划仍会继续。')}
  const displayDate=(item:PlanItem)=>selectedDate&&occurs(item,selectedDate)?selectedDate:item.date
  const occurrenceDone=(item:PlanItem)=>((item.recurrence??'none')!=='none'?Boolean(item.completedOccurrences?.includes(displayDate(item))):item.status==='done')
  function toMemory() {
    if (!memoryPlan) return
    const source = `来自已完成的${memoryPlan.kind} · ${memoryPlan.id}:${memoryPlan.date}`
    if (store.records.some(item => item.source === source && item.status === 'confirmed')) { notify('这件事已经存入回忆了。'); setMemoryPlan(null); return }
    const item: RecordItem = { id: makeId(), title: memoryPlan.title, body: `我们完成了：${memoryPlan.title}。`, date: memoryPlan.date || currentDate, kind: '回忆', source, status: 'confirmed' }
    update(value => ({ ...value, records: [item, ...value.records] }), '这件事已成为正式回忆，可以前往回忆页补充故事和照片。'); setMemoryPlan(null)
  }
  const renderPlan=(item:PlanItem)=>{
    const date=displayDate(item),done=occurrenceDone(item),recurring=(item.recurrence??'none')!=='none',memorySource=`来自已完成的${item.kind} · ${item.id}:${date}`
    return <article key={`${item.id}:${date}`} className={`panel core-plan-card core-plan-${item.status==='cancelled'?'cancelled':done?'done':'todo'}`}><div className="core-plan-main"><button className="core-check-plan" disabled={item.status==='cancelled'} aria-label={done?`将${item.title}的${date}恢复为待完成`:`完成${item.title}的${date}`} aria-pressed={done} onClick={()=>toggleOccurrence(item,date)}>{done&&<Icon name="check" size={15}/>}</button><div><div className="core-plan-title-row"><span className="tag">{item.kind}</span>{recurring&&<small>{recurrenceLabel(item)}</small>}{done&&<small>本次已完成</small>}{item.status==='cancelled'&&<small>已取消</small>}</div><h3>{item.title}</h3><p><Icon name="calendar" size={13}/>{date?fmtDate(date):'还没定时间'}{item.time&&` · ${item.time}`}{item.timezone&&` · ${item.timezone}`}{item.reminderMinutes!==undefined&&item.reminderMinutes!==null&&` · ${item.reminderMinutes===0?'准时提醒':`提前 ${item.reminderMinutes} 分钟`}`}</p></div></div>{cancelId===item.id?<div className="core-plan-cancel"><span>{recurring?'取消整个重复安排？已完成实例会保留在记录中。':'取消这次安排？记录会保留。'}</span><button className="core-text-button" onClick={()=>setCancelId(null)}>保留</button><button className="btn small danger" onClick={()=>status(item.id,'cancelled')}>确认取消</button></div>:<div className="core-plan-actions">{item.status==='cancelled'?<button className="core-text-button" onClick={()=>status(item.id,'todo')}>恢复安排</button>:<><button className="core-text-button" onClick={()=>setEditing(item)}>编辑</button><button className="core-text-button" onClick={()=>setCancelId(item.id)}>取消安排</button>{done&&(store.records.some(record=>record.source===memorySource&&record.status==='confirmed')?<span className="core-plan-memory-saved">已存入回忆</span>:<button className="btn secondary small" onClick={()=>setMemoryPlan({...item,date})}>存成回忆 <Icon name="arrow" size={13}/></button>)}</>}</div>}</article>
  }
  return <div className="core-page"><div className="core-planner-intro"><div><span className="core-kicker">THINGS TO LOOK FORWARD TO</span><h2>下一件小事，也想和你一起。</h2><p>还有 {upcoming.length} 件值得期待的事，慢慢来，一件件实现。</p></div><div className="core-inline"><button className="btn secondary" disabled={permission==='granted'||permission==='unsupported'} onClick={()=>void requestReminderPermission().then(setPermission)}><Icon name="bell" size={16}/>{permission==='granted'?'浏览器通知已允许':permission==='denied'?'通知已被浏览器拒绝':permission==='unsupported'?'浏览器不支持通知':'允许浏览器通知'}</button><button className="btn primary" onClick={create}><Icon name="plus" size={16}/>添加一件事</button></div></div><p className="core-info-strip">页内提醒不需要通知权限。浏览器通知只在页面打开或重新可见时检查；系统完全关闭浏览器后不保证准时触发。</p><div className="core-planner-layout"><section className="panel core-calendar"><div className="core-calendar-heading"><div><span>{year}</span><h2>{new Date(year, monthNumber - 1, 1).toLocaleDateString('zh-CN', { month: 'long' })}</h2></div><div className="core-inline"><button className="core-calendar-arrow" aria-label="上一个月" onClick={() => moveMonth(-1)}>‹</button><button className="btn small secondary" onClick={() => { setMonth(currentDate.slice(0, 7)); setSelectedDate(currentDate) }}>今天</button><button className="core-calendar-arrow" aria-label="下一个月" onClick={() => moveMonth(1)}>›</button></div></div><div className="core-weekdays">{['一', '二', '三', '四', '五', '六', '日'].map(day => <span key={day}>{day}</span>)}</div><div className="core-calendar-grid">{Array.from({ length: cellCount }, (_, index) => { const day = index - firstWeekday + 1; if (day < 1 || day > days) return <span key={index} className="core-calendar-blank" />; const date = `${month}-${String(day).padStart(2, '0')}`; const items = store.plans.filter(item => occurs(item,date) && item.status !== 'cancelled'); return <button key={date} className={`${date === currentDate ? 'today' : ''} ${date === selectedDate ? 'selected' : ''}`} aria-label={`${date}${items.length ? `，${items.length} 项安排` : ''}`} aria-pressed={date === selectedDate} onClick={() => setSelectedDate(date === selectedDate ? null : date)}><span>{day}</span><div className="core-day-dots">{items.slice(0, 3).map(item => <i key={item.id} className={((item.recurrence??'none')!=='none'?item.completedOccurrences?.includes(date):item.status==='done')?'done':''} />)}</div></button> })}</div><div className="core-calendar-key"><span><i />待完成</span><span><i className="done" />已完成</span>{selectedDate && <button className="core-text-button" onClick={() => setSelectedDate(null)}>查看全部日期</button>}</div><div className="core-calendar-note"><Icon name="heart" size={20} /><p>心愿不必着急实现。<br />一起期待，本身也是好事。</p></div></section><section className="core-plan-list-section"><div className="core-filter-pills core-plan-filters" aria-label="计划类型">{['全部', ...planKinds, '已取消'].map(value => <button key={value} className={filter === value ? 'active' : ''} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value}</button>)}</div><div className="core-plan-list-heading"><h3>{selectedDate ? fmtDate(selectedDate) : '我们的清单'}</h3><span>{plans.length} 件事</span></div>{plans.length ? <div className="core-plan-list">{plans.map(renderPlan)}</div> : <div className="panel"><Empty text={selectedDate ? '这一天还没有安排，留一点空白也很好。' : '这里还没有事情，写下一个小小的期待吧。'} action={<button className="btn secondary" onClick={create}>添加一件事</button>} /></div>}</section></div>{editing && <PlanEditor item={editing} onClose={() => setEditing(null)} onSave={save} />}{memoryPlan && <Modal title="把完成的心愿，留成一段回忆" onClose={() => setMemoryPlan(null)}><div className="core-convert-memory"><span className="tag">已完成 · {memoryPlan.kind}</span><h3>{memoryPlan.title}</h3><p>确认后，将以 {fmtDate(memoryPlan.date || currentDate)} 创建一条正式回忆，并保留这件事作为来源。你可以在回忆页补充文字和照片。</p><div className="core-modal-actions"><button className="btn secondary" onClick={() => setMemoryPlan(null)}>暂时不保存</button><button className="btn primary" onClick={toMemory}>确认存成回忆</button></div></div></Modal>}</div>
}
