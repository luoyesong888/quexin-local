import type {AgentProposal} from './agent-skills'

const escapeIcs=(value:string)=>value.replaceAll('\\','\\\\').replaceAll('\n','\\n').replaceAll(',','\\,').replaceAll(';','\\;')
const compactDate=(value:string)=>value.replaceAll('-','')
const compactTime=(value:string)=>value.replace(':','')+'00'
const download=(content:string,filename:string,type:string)=>{const url=URL.createObjectURL(new Blob([content],{type})),anchor=document.createElement('a');anchor.href=url;anchor.download=filename;anchor.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000)}

export function downloadCalendarDraft(proposal:AgentProposal):string{
 const {title='',date='',time='',description=''}=proposal.fields
 if(!title||!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('日历草稿缺少有效标题或日期')
 const start=time?`DTSTART:${compactDate(date)}T${compactTime(time)}`:`DTSTART;VALUE=DATE:${compactDate(date)}`
 const content=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Quexin//Qingniao Agent//ZH-CN','CALSCALE:GREGORIAN','BEGIN:VEVENT',`UID:${proposal.id}@quexin.local`,`DTSTAMP:${new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'')}`,start,`SUMMARY:${escapeIcs(title)}`,`DESCRIPTION:${escapeIcs(description)}`,'END:VEVENT','END:VCALENDAR',''].join('\r\n')
 download(content,`${title.replace(/[\\/:*?"<>|]/g,'-').slice(0,50)||'青鸟日历'}.ics`,'text/calendar;charset=utf-8')
 return'ICS 日历草稿已下载；是否导入由你在系统日历中决定。'
}

export function openEmailDraft(proposal:AgentProposal):string{
 const {recipient='',subject='',body=''}=proposal.fields
 if(!subject||!body)throw new Error('邮件草稿缺少主题或正文')
 const href=`mailto:${encodeURIComponent(recipient)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
 window.location.assign(href)
 return'已交给本机邮件客户端；鹊信没有自动发送邮件。'
}
