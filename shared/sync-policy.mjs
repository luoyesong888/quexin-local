// Pure policy shared by the page and the generated Service Worker.
export function canCite(record){return record.status==='confirmed'&&!record.sensitive&&record.mediaScope!=='private'}
export function canSharePlan(plan,records){
 if(plan.sensitive)return false
 const sourceId=plan.sourceRecordId??(plan.id.startsWith('record-')?plan.id.slice(7):null)
 return !sourceId||records.some(record=>record.id===sourceId&&canCite(record))
}
export function syncPayload(item){
 const {image:_image,imageThumbnail:_thumbnail,expectedVersion:_expected,entityVersion:_version,...payload}=item
 return {...payload,visibility:'shared'}
}
export function fingerprint(value){
 const input=JSON.stringify(value);let hash=2166136261
 for(let i=0;i<input.length;i++){hash^=input.charCodeAt(i);hash=Math.imul(hash,16777619)}
 return (hash>>>0).toString(16).padStart(8,'0')
}
export function shareableEntities(store){
 return [
  ...store.records.filter(canCite).map(item=>({entity:'record',item})),
  ...store.plans.filter(item=>canSharePlan(item,store.records)).map(item=>({entity:'plan',item})),
  ...store.journals.filter(item=>!item.sensitive&&!item.title.startsWith('私人草稿 · ')&&item.type!=='时光胶囊').map(item=>({entity:'journal',item})),
 ]
}
export function pruneQueuedChanges(queue,store){
 const current=new Map(shareableEntities(store).map(({entity,item})=>[`${entity}:${item.id}`,JSON.stringify(syncPayload(item))]))
 return queue.filter(entry=>['delete','withdraw'].includes(entry.command.operation)?!current.has(entry.key):current.get(entry.key)===JSON.stringify(entry.command.payload))
}
export function privateEntityKeys(store){
 const shared=new Set(shareableEntities(store).map(({entity,item})=>`${entity}:${item.id}`))
 return new Set([['record',store.records],['plan',store.plans],['journal',store.journals]].flatMap(([kind,items])=>items.map(item=>`${kind}:${item.id}`)).filter(key=>!shared.has(key)))
}
