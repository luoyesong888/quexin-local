import type {RecordItem} from './domain'
import {provenanceLabel} from './import-source'

export function RecordSource({record}:{record:RecordItem}){
  const p=record.provenance
  return <section className="record-evidence" aria-label="记录来源">
    <h3>原文依据</h3>
    {p?<><p className="muted">{provenanceLabel(p)} · {p.type==='image-manual'?'图片文字为人工填写':p.type==='image-ocr'?'图片 OCR 后人工核对':p.type==='audio-transcript'?'录音转写后人工核对':p.type==='csv'?'CSV 主动导入':p.type==='html'?'HTML 主动导入':p.type==='sample'?'虚构样例':'主动导入'}</p><blockquote>{p.original}</blockquote>{p.mapped!==p.original&&<details><summary>查看人物映射后的文字</summary><p>{p.mapped}</p></details>}<small>整理基准日：{p.baseDate} · 导入时间：{new Date(p.importedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}</small></>:<blockquote>{record.source||'本人手动记录'}</blockquote>}
  </section>
}
