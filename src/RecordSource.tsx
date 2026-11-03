import type {RecordItem} from './domain'
import {provenanceLabel} from './import-source'
import {useEffect,useRef,useState} from 'react'
import {chatRequest,type ChatOriginal} from './workbuddy-chat'

export function RecordSource({record}:{record:RecordItem}){
  const p=record.provenance
  const [original,setOriginal]=useState<ChatOriginal|null>(null),[error,setError]=useState('')
  const controller=useRef<AbortController|null>(null)
  useEffect(()=>{setOriginal(null);setError('');return()=>controller.current?.abort()},[record.id])
  return <section className="record-evidence" aria-label="记录来源">
    <h3>原文依据</h3>
    {p?.type==='workbuddy-chat'&&p.chatRef&&<div><p>WorkBuddy 私人聊天归档 · 保存的仅是所选片段</p><small>批次 {p.batchId} · {p.chatRef.chunkFile} 第 {p.chatRef.chunkLine} 行</small><button className="text-link" onClick={()=>{const ref=p.chatRef!,abort=new AbortController();controller.current?.abort();controller.current=abort;setError('');void chatRequest<ChatOriginal|null>('message',ref.ownerId,{expectedSpaceId:ref.spaceId,conversationId:ref.conversationId,messageId:ref.messageId},abort.signal).then(value=>{if(abort.signal.aborted)return;setOriginal(value);if(!value)setError('本机归档中未找到这条消息。')}).catch(cause=>{if(!abort.signal.aborted)setError(cause instanceof Error?cause.message:'无法读取原文。')})}}>从本机归档查看完整原文</button>{original&&<blockquote>{original.text}</blockquote>}{error&&<p role="alert">{error}</p>}</div>}
    {p?<><p className="muted">{provenanceLabel(p)} · {p.type==='image-manual'?'图片文字为人工填写':p.type==='image-ocr'?'图片 OCR 后人工核对':p.type==='audio-transcript'?'录音转写后人工核对':p.type==='csv'?'CSV 主动导入':p.type==='html'?'HTML 主动导入':p.type==='sample'?'虚构样例':p.type==='workbuddy-chat'?'WorkBuddy 归档片段':'主动导入'}</p><blockquote>{p.original}</blockquote>{p.mapped!==p.original&&<details><summary>查看人物映射后的文字</summary><p>{p.mapped}</p></details>}<small>整理基准日：{p.baseDate} · 导入时间：{new Date(p.importedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}</small></>:<blockquote>{record.source||'本人手动记录'}</blockquote>}
  </section>
}
