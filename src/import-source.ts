export type RecordProvenance = {
  batchId: string
  type: 'text' | 'txt' | 'json' | 'csv' | 'html' | 'image-manual' | 'image-ocr' | 'audio-transcript' | 'sample'
  label: string
  line: number
  original: string
  mapped: string
  importedAt: string
  baseDate: string
}
export type ImportFileKind='image'|'audio'|'json'|'csv'|'html'|'text'|'unsupported'
export function importFilePolicy(name:string,type:string):{kind:ImportFileKind;maximum:number}{
 const lower=name.toLowerCase()
 if(['image/jpeg','image/png','image/webp','image/gif'].includes(type))return{kind:'image',maximum:10*1024*1024}
 if(['audio/flac','audio/mpeg','audio/mp4','audio/ogg','audio/wav','audio/x-wav','audio/webm','audio/m4a','audio/x-m4a','video/mp4'].includes(type)||/\.(mp3|mp4|mpeg|mpga|m4a|ogg|wav|webm|flac)$/i.test(lower))return{kind:'audio',maximum:25*1024*1024}
 if(lower.endsWith('.json'))return{kind:'json',maximum:2*1024*1024}
 if(lower.endsWith('.csv'))return{kind:'csv',maximum:2*1024*1024}
 if(/\.html?$/.test(lower))return{kind:'html',maximum:2*1024*1024}
 if(lower.endsWith('.txt'))return{kind:'text',maximum:2*1024*1024}
 return{kind:'unsupported',maximum:0}
}

export function importLines(text:string){
  return text.split(/\r?\n/).map((original,index)=>({original,line:index+1})).filter(item=>item.original.trim())
}

export function mapSpeaker(line:string,selfAlias:string,selfName:string,partnerAlias:string,partnerName:string):string{
  const match=line.match(/^(\s*(?:\[?20\d{2}[-/年]\d{1,2}[-/月]\d{1,2}日?(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?\]?\s*)?)([^：:]{1,30})([：:]\s*)([\s\S]*)$/)
  if(!match)return line
  const [,prefix,speaker,separator,body]=match
  const name=speaker.trim()===selfAlias.trim()?selfName:speaker.trim()===partnerAlias.trim()?partnerName:speaker
  return `${prefix}${name}${separator}${body}`
}

export function jsonMessagesToText(value:unknown):string{
  const container=value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null
  const messages=Array.isArray(value)?value:Array.isArray(container?.messages)?container.messages:Array.isArray(container?.records)?container.records:[value]
  if(messages.length>1000)throw new Error('一次最多导入 1000 条消息，请分批导入。')
  const lines=messages.map((entry,index)=>{
    if(typeof entry==='string')return entry
    if(!entry||typeof entry!=='object'||Array.isArray(entry))throw new Error(`第 ${index+1} 条消息格式无效。`)
    const message=entry as Record<string,unknown>,body=message.text??message.content??message.body
    if(typeof body!=='string')throw new Error(`第 ${index+1} 条消息缺少 text、content 或 body 文本。`)
    const speaker=message.sender??message.name??message.person,time=message.date??message.time??message.timestamp
    return `${typeof time==='string'?`${time} `:''}${typeof speaker==='string'?`${speaker}：`:''}${body}`
  })
  const text=lines.join('\n')
  if(text.length>100000)throw new Error('内容超过 10 万字，请分批导入。')
  return text
}

function limitedText(lines:string[]):string{
 if(lines.length>1000)throw new Error('一次最多导入 1000 条消息，请分批导入。')
 const text=lines.map(line=>line.trim()).filter(Boolean).join('\n')
 if(!text)throw new Error('文件中没有可读取的消息文字。')
 if(text.length>100000)throw new Error('内容超过 10 万字，请分批导入。')
 return text
}
function csvRows(input:string):string[][]{
 const rows:string[][]=[];let row:string[]=[],cell='',quoted=false
 for(let i=0;i<input.length;i++){
  const char=input[i]
  if(quoted){if(char==='"'&&input[i+1]==='"'){cell+='"';i++}else if(char==='"')quoted=false;else cell+=char;continue}
  if(char==='"'){quoted=true;continue}
  if(char===','){row.push(cell);cell='';continue}
  if(char==='\n'){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell='';continue}
  cell+=char
 }
 if(quoted)throw new Error('CSV 引号没有正确结束。')
 if(cell||row.length){row.push(cell.replace(/\r$/,''));rows.push(row)}
 return rows.filter(row=>row.some(cell=>cell.trim()))
}
export function csvMessagesToText(input:string):string{
 const rows=csvRows(input);if(rows.length<2)throw new Error('CSV 至少需要表头和一条消息。')
 const headers=rows[0].map(value=>value.trim().toLowerCase()),index=(names:string[])=>headers.findIndex(header=>names.includes(header))
 const body=index(['text','content','body','message','消息','内容','正文']),sender=index(['sender','name','person','speaker','发送者','姓名','人物']),time=index(['date','time','timestamp','datetime','日期','时间'])
 if(body<0)throw new Error('CSV 缺少 text、content、message 或“内容”列。')
 return limitedText(rows.slice(1).map((cells,row)=>{const text=cells[body]?.trim();if(!text)throw new Error(`CSV 第 ${row+2} 行缺少消息内容。`);return `${time>=0&&cells[time]?.trim()?`${cells[time].trim()} `:''}${sender>=0&&cells[sender]?.trim()?`${cells[sender].trim()}：`:''}${text}`}))
}
export function htmlMessagesToText(input:string):string{
 const clean=input.replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi,'')
 const entities=(value:string)=>value.replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&#(\d+);/g,(_,code)=>String.fromCodePoint(Number(code))).replace(/\s+/g,' ').trim()
 const table=[...clean.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(row=>[...row[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(cell=>entities(cell[1]))).filter(row=>row.length)
 if(table.length>1)return csvMessagesToText(table.map(row=>row.map(cell=>`"${cell.replaceAll('"','""')}"`).join(',')).join('\n'))
 const selected=[...clean.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi),...clean.matchAll(/<(?:div|p)\b[^>]*(?:data-message|class\s*=\s*(?:"[^"]*(?:message|chat-message|msg)[^"]*"|'[^']*(?:message|chat-message|msg)[^']*'))[^>]*>([\s\S]*?)<\/(?:div|p)>/gi)].map(match=>entities(match[1])).filter(Boolean)
 if(selected.length)return limitedText(selected)
 const lines=clean.replace(/<\/(?:p|div|li|tr|h[1-6])>/gi,'\n').split(/\r?\n/).map(entities)
 return limitedText(lines)
}

export function provenanceLabel(source?:RecordProvenance):string{
  return source?`${source.label} · 第 ${source.line} 行`: '手动记录或已有资料'
}
