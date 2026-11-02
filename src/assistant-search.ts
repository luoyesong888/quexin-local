import type {DemoStore,PlanItem,RecordItem} from './domain'
import {canCite,canSharePlan} from '../shared/sync-policy.mjs'
export {canCite,canSharePlan} from '../shared/sync-policy.mjs'
export type SearchAnswer={question:string;text:string;records:RecordItem[];plans:PlanItem[]}
const dateLabel=(date:string)=>date||'日期未确定'
function keywords(query:string){
  return query.toLowerCase().replace(/[？?，,。！!]/g,' ').split(/第一次|最近|我们|一起|一下|帮我|看看|回忆|是什么时候|什么时候|什么时候的|在哪里|哪里|哪些|有没有|关于|的|和|在|去|是|了|呢|吗|想|过|吃|\s+/).map(part=>part.trim()).filter(part=>part.length>=2)
}
export function answerFromRecords(question:string,store:DemoStore):SearchAnswer{
  const result:SearchAnswer={question,text:'',records:[],plans:[]}
  if(store.settings.aiMode==='off')return{...result,text:'助手已关闭。可以在「系统 → 空间与功能」开启本地规则整理，或直接浏览已保存的资料。'}
  const records=store.records.filter(canCite)
  if(/相伴|多少天|在一起多久/.test(question)){
    const now=new Date(),today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now)
    const days=Math.floor((Date.parse(today)-Date.parse(store.settings.since))/86400000)+1
    return{...result,text:`根据空间资料中的开始日期 ${store.settings.since}，相伴 ${Math.max(1,days)} 天。这是日期计算，不是从聊天推断。`}
  }
  if(/接下来|有什么安排|有哪些计划|日程|纪念日/.test(question)){
    const plans=store.plans.filter(plan=>plan.status==='todo'&&canSharePlan(plan,store.records)).sort((a,b)=>(a.date||'9999').localeCompare(b.date||'9999')).slice(0,4)
    return{...result,plans,records:records.filter(r=>plans.some(p=>p.sourceRecordId===r.id||p.id===`record-${r.id}`)),text:plans.length?'已保存的安排：\n'+plans.map(p=>`${dateLabel(p.date)} ${p.time} · ${p.title}`).join('\n'):'目前没有可引用的待完成安排。'}
  }
  const terms=keywords(question)
  const ranked=records.map(record=>{
    const body=`${record.title} ${record.body}`.toLowerCase()
    const score=terms.reduce((sum,term)=>{
      if(body.includes(term))return sum+term.length*3
      if(term.length<3)return sum
      const pairs=[...new Set(Array.from({length:term.length-1},(_,i)=>term.slice(i,i+2)))],matches=pairs.filter(pair=>body.includes(pair)).length
      return sum+(matches>=Math.ceil(pairs.length*.6)?matches:0)
    },0)
    return{record,score}
  }).filter(item=>item.score>0)
  const recent=/最近的回忆|最近记住|所有回忆/.test(question)
  let found=recent?records.filter(r=>r.kind==='回忆'):ranked.sort((a,b)=>b.score-a.score||b.record.date.localeCompare(a.record.date)).map(item=>item.record)
  const first=/第一次|最早/.test(question)
  if(first)found=found.filter(r=>r.date).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,1)
  else if(recent)found.sort((a,b)=>b.date.localeCompare(a.date))
  found=found.slice(0,3)
  const text=found.length?(first?'在可引用的已确认资料中，日期最早的一条是（不代表实际第一次）：\n':`找到 ${found.length} 条已确认记录：\n`)+found.map(r=>`${dateLabel(r.date)} · ${r.title}\n${r.body}`).join('\n\n'):'没有找到可引用的已确认资料。可以换个关键词，或先核对导入候选；私人、已忽略和待确认内容不参与回答。'
  return{...result,text,records:found}
}
