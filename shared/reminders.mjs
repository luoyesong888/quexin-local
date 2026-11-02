const DAY=86_400_000
const dateParts=value=>{const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value);return m?{year:+m[1],month:+m[2],day:+m[3]}:null}
const dateAt=(year,month,day)=>{const d=new Date(Date.UTC(year,month-1,day));return d.getUTCFullYear()===year&&d.getUTCMonth()===month-1&&d.getUTCDate()===day?d:null}
const dateText=date=>date.toISOString().slice(0,10)
export function validTimeZone(zone){try{new Intl.DateTimeFormat('en',{timeZone:zone}).format();return true}catch{return false}}
export function recurrenceDates(plan,from,to,limit=500){
 const first=dateParts(plan.date);if(!first||!dateParts(from)||!dateParts(to)||from>to)return[]
 const recurrence=plan.recurrence??'none',until=plan.recurrenceUntil||'9999-12-31',result=[]
 if(recurrence==='none')return plan.date>=from&&plan.date<=to&&plan.date<=until?[plan.date]:[]
 for(let step=0;step<4000&&result.length<limit;step++){
  let candidate
  if(recurrence==='daily')candidate=new Date(Date.UTC(first.year,first.month-1,first.day+step))
  else if(recurrence==='weekly')candidate=new Date(Date.UTC(first.year,first.month-1,first.day+step*7))
  else if(recurrence==='monthly'){const month=first.month-1+step,year=first.year+Math.floor(month/12),normalized=(month%12+12)%12+1;candidate=dateAt(year,normalized,first.day)}
  else candidate=dateAt(first.year+step,first.month,first.day)
  if(!candidate)continue
  const value=dateText(candidate);if(value>until||value>to)break;if(value>=from&&value>=plan.date)result.push(value)
 }
 return result
}
function formatterParts(epoch,zone){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(epoch));return Object.fromEntries(parts.filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]))}
export function zonedDateTimeEpoch(date,time,zone){
 if(!dateParts(date)||!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)||!validTimeZone(zone))return NaN
 const p=dateParts(date),[hour,minute]=time.split(':').map(Number),target=Date.UTC(p.year,p.month-1,p.day,hour,minute,0);let guess=target
 for(let i=0;i<3;i++){const seen=formatterParts(guess,zone),asUtc=Date.UTC(seen.year,seen.month-1,seen.day,seen.hour,seen.minute,seen.second);guess+=target-asUtc}
 const final=formatterParts(guess,zone);return final.year===p.year&&final.month===p.month&&final.day===p.day&&final.hour===hour&&final.minute===minute?guess:NaN
}
export function reminderOccurrences(plan,now=Date.now(),catchUpMs=24*60*60_000){
 if(plan.status!=='todo'||!plan.date||!plan.time||plan.reminderMinutes===undefined||plan.reminderMinutes===null)return[]
 const zone=validTimeZone(plan.timezone??'')?plan.timezone:'Asia/Shanghai',start=dateText(new Date(now-catchUpMs-2*DAY)),end=dateText(new Date(now+2*DAY))
 return recurrenceDates(plan,start,end).filter(date=>!plan.completedOccurrences?.includes(date)).map(date=>{const eventAt=zonedDateTimeEpoch(date,plan.time,zone),reminderAt=eventAt-Number(plan.reminderMinutes)*60_000;return{key:`${plan.id}:${date}:${plan.time}:${plan.reminderMinutes}`,planId:plan.id,title:plan.title,date,time:plan.time,timezone:zone,eventAt,reminderAt}}).filter(item=>Number.isFinite(item.reminderAt)&&item.reminderAt<=now&&item.reminderAt>now-catchUpMs)
}
export function recurrenceLabel(plan){return({none:'不重复',daily:'每天',weekly:'每周',monthly:'每月',yearly:'每年'})[plan.recurrence??'none']}
