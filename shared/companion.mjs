const clamp=value=>Math.max(0,Math.min(100,value))
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.trim().length<=max?value.trim():null
export function initialCompanion(members,createdAt){
  return{revision:0,profile:{ownerName:members.find(m=>m.role==='owner')?.displayName??'我',partnerName:members.find(m=>m.role==='partner')?.displayName??'TA',since:createdAt.slice(0,10)},pet:{name:'小鹊',energy:72,curiosity:66,comfort:70,feathers:0,room:'study',pose:'idle',log:[]},events:[],growthSources:[]}
}
export function memoryContribution(payload){return Math.min(8,4+(payload?.image||payload?.mediaId?2:0)+(payload?.provenance||payload?.source?1:0)+(String(payload?.body??'').length>=120?1:0))}
export function applyCompanionAction(current,action,actor,now=new Date().toISOString()){
  const next=structuredClone(current),pet=next.pet
  let description
  switch(action.kind){
    case 'touch':pet.energy=clamp(pet.energy-2);pet.comfort=clamp(pet.comfort+10);pet.curiosity=clamp(pet.curiosity+3);pet.feathers+=2;pet.pose='happy';description='温柔地摸了摸小伙伴';break
    case 'feed':pet.energy=clamp(pet.energy+12);pet.comfort=clamp(pet.comfort+4);pet.curiosity=clamp(pet.curiosity+3);pet.feathers+=3;pet.pose='eat';description='给小伙伴喂了点心';break
    case 'rest':pet.energy=clamp(pet.energy+18);pet.comfort=clamp(pet.comfort+4);pet.curiosity=clamp(pet.curiosity-2);pet.feathers+=1;pet.pose='sleep';description='让小伙伴安心休息';break
    case 'wake':pet.pose='idle';description='唤醒了小伙伴';break
    case 'rename':if(!text(action.name,12))throw new Error('名字需要 1—12 个字符');pet.name=action.name.trim();description=`给小伙伴起名为「${pet.name}」`;break
    case 'room':if(!['study','garden','cosmos'].includes(action.room))throw new Error('请选择有效房间');pet.room=action.room;description=`布置了${{study:'窗边书房',garden:'庭院春深',cosmos:'星河小屋'}[action.room]}`;break
    case 'journey':if(!text(action.title,120))throw new Error('请选择有效心愿');pet.curiosity=clamp(pet.curiosity+8);description=`开启了心愿旅程：${action.title.trim()}`;break
    case 'preen':pet.comfort=clamp(pet.comfort+6);pet.energy=clamp(pet.energy-1);pet.feathers+=1;pet.pose='idle';description='陪小伙伴梳理了羽毛';break
    case 'deliver':pet.curiosity=clamp(pet.curiosity+6);pet.comfort=clamp(pet.comfort+3);pet.feathers+=2;pet.pose='happy';description='和小伙伴一起送出了一封信';break
    case 'explore':pet.curiosity=clamp(pet.curiosity+10);pet.energy=clamp(pet.energy-4);pet.feathers+=2;pet.pose='happy';description='陪小伙伴探索了新的角落';break
    case 'memory_growth':if(!text(action.sourceId,160)||!text(action.title,160)||!Number.isInteger(action.contribution)||action.contribution<1||action.contribution>8)throw new Error('成长来源无效');pet.feathers+=action.contribution;pet.curiosity=clamp(pet.curiosity+2);description=`从共同回忆「${action.title.trim()}」获得 ${action.contribution} 羽光`;break
    case 'profile':{
      const p=action.profile
      if(!p||!text(p.selfName,16)||!text(p.partnerName,16)||!/^\d{4}-\d{2}-\d{2}$/.test(p.since)||!Number.isFinite(Date.parse(p.since))||new Date(p.since).toISOString().slice(0,10)!==p.since)throw new Error('请填写有效的双方称呼和纪念日期')
      next.profile={ownerName:actor.role==='owner'?p.selfName.trim():p.partnerName.trim(),partnerName:actor.role==='partner'?p.selfName.trim():p.partnerName.trim(),since:p.since};description='更新了我们的空间资料';break
    }
    default:throw new Error('未知的共同空间操作')
  }
  next.revision=current.revision+1
  const entry={id:action.commandId,actorId:actor.userId,actorName:actor.displayName,kind:action.kind,at:now,text:action.kind==='memory_growth'?description:`${actor.displayName}${description}`,...(action.sourceId?{sourceId:action.sourceId}:{}),...(action.contribution?{contribution:action.contribution}:{})}
  next.events=[entry,...next.events].slice(0,100)
  if(action.kind!=='memory_growth')pet.log=[`${now.slice(5,10)} · ${entry.text}`,...pet.log].slice(0,60)
  return next
}
