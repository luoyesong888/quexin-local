import {test,expect} from '@playwright/test'
import {jsonMessagesToText,csvMessagesToText,htmlMessagesToText,importFilePolicy,mapSpeaker,importLines} from '../../src/import-source'
import {answerFromRecords,canSharePlan} from '../../src/assistant-search'
import {createEmptyStore,extractCandidates,isDemoStore} from '../../src/data'
import {shareableEntities} from '../../src/sync-queue'

test('JSON 支持消息容器且拒绝未知对象，行号和人物映射保留依据',()=>{
  expect(jsonMessagesToText({messages:[{sender:'我',date:'2026-10-20',text:'今天去海边。'}]})).toBe('2026-10-20 我：今天去海边。')
  expect(()=>jsonMessagesToText({unrelated:'不能变成候选'})).toThrow('缺少')
  expect(()=>jsonMessagesToText(Array.from({length:1001},()=>''))).toThrow('1000')
  expect(mapSpeaker('2026-10-20 18:20 我：今天去海边。','我','对方','对方','小满')).toBe('2026-10-20 18:20 对方：今天去海边。')
  expect(importLines('\n我：海边\n\n对方：咖啡').map(r=>r.line)).toEqual([2,4])
})
test('CSV 与 HTML 主动导入保留消息顺序并拒绝错误结构',()=>{
 expect(csvMessagesToText('date,sender,text\n2026-10-20,我,"一起去海边, 看日落"\n2026-10-21,对方,好呀')).toBe('2026-10-20 我：一起去海边, 看日落\n2026-10-21 对方：好呀')
 expect(()=>csvMessagesToText('sender,unknown\n我,没有正文列')).toThrow('缺少')
 expect(htmlMessagesToText('<ul><li>我：一起去公园。</li><li>对方：带上相机。</li></ul>')).toBe('我：一起去公园。\n对方：带上相机。')
 expect(htmlMessagesToText('<table><tr><th>发送者</th><th>内容</th></tr><tr><td>我</td><td>喝咖啡</td></tr></table>')).toBe('我：喝咖啡')
})
test('文件类型与大小上限固定，未知格式不伪装成聊天',()=>{
 expect(importFilePolicy('chat.csv','text/csv')).toEqual({kind:'csv',maximum:2*1024*1024})
 expect(importFilePolicy('screen.png','image/png')).toEqual({kind:'image',maximum:10*1024*1024})
 expect(importFilePolicy('voice.wav','audio/wav')).toEqual({kind:'audio',maximum:25*1024*1024})
 expect(importFilePolicy('archive.zip','application/zip')).toEqual({kind:'unsupported',maximum:0})
})
test('日期歧义与私人内容独立，未知日期不猜作今天',()=>{
  const [wish]=extractCandidates('我：下周一起去海边。','2026-10-30')
  expect(wish).toMatchObject({date:'',sensitive:false,needsDateReview:true,kind:'心愿'})
  const [privatePlan]=extractCandidates('对方：明天预约私人医院体检。','2026-10-30')
  expect(privatePlan).toMatchObject({date:'2026-10-31',sensitive:true,kind:'计划'})
  expect(extractCandidates('我：走过了一条山路。','2026-10-30')[0].date).toBe('')
  expect(extractCandidates('我：昨天见面，明天再去海边。','2026-10-30')[0]).toMatchObject({date:'',needsDateReview:true})
})
test('问答和同步排除私人候选及其派生日程，删除后没有旧引用',()=>{
  const store=createEmptyStore(),[publicRecord]=extractCandidates('我：2026-10-20，一起去海边。','2026-10-30'),[privateRecord]=extractCandidates('我：明天私人医院体检。','2026-10-30')
  publicRecord.status='confirmed';privateRecord.status='confirmed';store.records=[publicRecord,privateRecord]
  store.plans=[{id:`record-${privateRecord.id}`,title:'私人医院体检',date:'2026-10-31',time:'',status:'todo',kind:'计划'}]
  expect(canSharePlan(store.plans[0],store.records)).toBe(false)
  expect(shareableEntities(store).some(item=>item.entity==='plan')).toBe(false)
  expect(answerFromRecords('医院',store).records).toHaveLength(0)
  const result=answerFromRecords('第一次一起去海边是什么时候？',store)
  expect(result.records[0].id).toBe(publicRecord.id);expect(result.text).toContain('不代表实际第一次')
  store.records=[];expect(answerFromRecords('海边',store).records).toHaveLength(0)
})
test('来源元数据可备份并校验非法结构，关闭规则后不回答',()=>{
  const store=createEmptyStore(),[record]=extractCandidates('我：今天去海边。','2026-10-30')
  record.status='confirmed';record.provenance={batchId:'batch',type:'txt',label:'chat.txt',line:1,original:'我：今天去海边。',mapped:'阿澄：今天去海边。',importedAt:new Date().toISOString(),baseDate:'2026-10-30'};store.records=[record]
  expect(isDemoStore(JSON.parse(JSON.stringify(store)))).toBe(true)
  expect(isDemoStore({...store,records:[{...record,provenance:{...record.provenance,line:-1}}]})).toBe(false)
  store.settings.aiMode='off';expect(answerFromRecords('海边',store).text).toContain('助手已关闭')
})
