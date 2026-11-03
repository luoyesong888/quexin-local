import {createServer} from 'node:http'
const port=Number(process.env.FAKE_MODEL_PORT??6094),stats={requests:[],aborted:0}
const json=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data))}
const event=(res,data)=>res.write(`data: ${JSON.stringify(data)}\n\n`)
createServer(async(req,res)=>{
 if(req.method==='GET'&&req.url==='/health')return json(res,200,{ok:true})
 if(req.method==='GET'&&req.url==='/stats')return json(res,200,stats)
 if(req.method==='POST'&&req.url==='/v1/audio/transcriptions'){
  if(req.headers.authorization!=='Bearer assistant-test-key')return json(res,401,{error:{message:'bad key'}})
  let raw='';for await(const chunk of req)raw+=chunk.toString('latin1');const row={kind:'transcription',contentType:req.headers['content-type'],size:raw.length,aborted:false};stats.requests.push(row);res.on('close',()=>{if(!res.writableEnded){row.aborted=true;stats.aborted++}})
  if(raw.includes('slow-cancel')){setTimeout(()=>{if(!res.destroyed)json(res,200,{text:'迟到的转写'})},8_000);return}
  return json(res,200,{text:'我：2026-10-22，录音转写的海边散步。'})
 }
 if(req.method!=='POST'||req.url!=='/v1/responses')return json(res,404,{error:{message:'not found'}})
 if(req.headers.authorization!=='Bearer assistant-test-key')return json(res,401,{error:{message:'bad key'}})
 let raw='';for await(const chunk of req)raw+=chunk
 const body=JSON.parse(raw),ocr=body.text?.format?.name==='quexin_ocr',creative=body.text?.format?.name==='quexin_creative',conversationRequest=body.text?.format?.name==='quexin_conversation',agent=body.text?.format?.name==='quexin_agent',input=ocr?body.input:JSON.parse(body.input),text=ocr?JSON.stringify(input):body.text?.format?.name==='quexin_candidates'?input.lines.map(line=>line.text).join('\n'):creative?input.instruction:conversationRequest?input.message:agent?input.goal:input.question
 const row={body,input,aborted:false};stats.requests.push(row);res.on('close',()=>{if(!res.writableEnded){row.aborted=true;stats.aborted++}})
 if(text.includes('http error'))return json(res,503,{error:{message:'provider unavailable'}})
 if(ocr)return json(res,200,{output_text:JSON.stringify({text:'我：2026-10-21，OCR 识别到一起去了海边。'})})
 res.writeHead(200,{'content-type':'text/event-stream'})
 if(text.includes('disconnect')){event(res,{type:'response.output_text.delta',delta:'{"answer":"中断'});setTimeout(()=>res.destroy(),20);return}
 if(text.includes('timeout')||text.includes('slow cancel')){setTimeout(()=>{if(!res.destroyed){event(res,{type:'response.output_text.delta',delta:JSON.stringify({answer:'迟到的答案',citationIds:[],uncertainty:''})});res.end()}},8_000);return}
 if(text.includes('refuse')){event(res,{type:'response.refusal.delta',delta:'refused'});res.end();return}
 let result
 if(creative)result={title:'青鸟起草的信',body:`根据已确认回忆写成的可编辑草稿：${input.sources[0]?.title??''}`,citationIds:input.sources[0]?[input.sources[0].id]:[],uncertainty:''}
 else if(conversationRequest){const previous=[...input.conversation].reverse().find(item=>item.role==='user')?.text??'';result={reply:text.includes('刚才说了什么')?`你刚才说的是：“${previous}”`:text.includes('你好')?'你好，我是青鸟。你可以和我聊天，也可以直接让我记录、安排或创作。':`我明白你的意思：${text}`,suggestedCommands:['记住一件重要的小事。','添加一个提醒。'],uncertainty:''}}
 else if(agent){
  const sourceIds=input.sources[0]?[input.sources[0].id]:[],blank={title:'',body:'',date:'',time:'',recordKind:'回忆',planKind:'计划',journalType:'日常',recurrence:'none',recurrenceUntil:'',reminderMinutes:0,careNeed:'想被听见',description:'',subject:'',recipient:'',productTool:'open-page',toolTarget:'',toolValue:''}
  if(input.mode==='command'){
   const base={summary:'已把直接指令整理成可审批的本地动作。',selectedSkills:['command-inbox'],steps:[{skillId:'command-inbox',title:'理解直接指令',reason:'用户在零资料状态下明确输入了管理指令'}],proposals:[],followUpQuestion:'',uncertainty:'只依据用户本次输入，不补充没有说明的事实。'}
   if(text.includes('打开导入'))result={...base,proposals:[{kind:'product_action',title:'打开产品页面',riskLevel:'L0',sourceIds:[],fields:{...blank,productTool:'open-page',toolTarget:'import',description:'兼容历史目标，打开内部资料核对页面'}}]}
   else if(text.includes('打开计划'))result={...base,proposals:[{kind:'product_action',title:'打开计划页面',riskLevel:'L0',sourceIds:[],fields:{...blank,productTool:'open-page',toolTarget:'planner',description:'打开鹊信的计划与日历页面'}}]}
   else if(text.includes('星河来信'))result={...base,proposals:[{kind:'product_action',title:'切换星河来信主题',riskLevel:'L1',sourceIds:[],fields:{...blank,productTool:'change-theme',toolValue:'cosmos',description:'把个人界面切换为星河来信主题'}}]}
   else if(text.includes('喂')&&text.includes('小鹊'))result={...base,proposals:[{kind:'product_action',title:'给小鹊喂食',riskLevel:'L1',sourceIds:[],fields:{...blank,productTool:'pet-feed',description:'执行一次鹊巢喂食互动'}}]}
   else if(text.includes('导出备份'))result={...base,proposals:[{kind:'product_action',title:'导出浏览器备份',riskLevel:'L1',sourceIds:[],fields:{...blank,productTool:'export-backup',description:'下载当前浏览器资料的 JSON 备份'}}]}
   else if(text.includes('不吃香菜'))result={...base,selectedSkills:[...base.selectedSkills,'personal-memory'],steps:[...base.steps,{skillId:'personal-memory',title:'生成偏好草稿',reason:'用户明确要求记住一项偏好'}],proposals:[{kind:'memory_draft',title:'不吃香菜',riskLevel:'L1',sourceIds:[],fields:{...blank,title:'小满不吃香菜',body:'小满不吃香菜。',date:input.today,recordKind:'偏好'}}]}
   else if(text.includes('每周六'))result={...base,selectedSkills:[...base.selectedSkills,'personal-planner'],steps:[...base.steps,{skillId:'personal-planner',title:'生成周期计划',reason:'用户明确提出每周重复的安排'}],proposals:[{kind:'plan_draft',title:'每周一起散步',riskLevel:'L1',sourceIds:[],fields:{...blank,title:'每周六一起散步',date:input.today,time:'18:00',planKind:'计划',recurrence:'weekly',reminderMinutes:60}}]}
   else if(text.includes('提醒'))result={...base,selectedSkills:[...base.selectedSkills,'personal-planner'],steps:[...base.steps,{skillId:'personal-planner',title:'生成提醒',reason:'用户明确要求在指定时间提醒'}],proposals:[{kind:'plan_draft',title:'准备纪念日礼物',riskLevel:'L1',sourceIds:[],fields:{...blank,title:'准备纪念日礼物',date:input.today,time:'09:00',planKind:'提醒',reminderMinutes:60}}]}
   else if(text.includes('累')||text.includes('关怀'))result={...base,selectedSkills:[...base.selectedSkills,'personal-journal'],steps:[...base.steps,{skillId:'personal-journal',title:'生成私人关怀草稿',reason:'用户明确要求保存当前需要'}],proposals:[{kind:'care_draft',title:'今天先休息一下',riskLevel:'L1',sourceIds:[],fields:{...blank,title:'今天先休息一下',body:'今天有点累，想先安静休息一下。',careNeed:'想安静'}}]}
   else result={...base,selectedSkills:[...base.selectedSkills,'personal-journal'],steps:[...base.steps,{skillId:'personal-journal',title:'生成信件草稿',reason:'用户明确要求起草一封信'}],proposals:[{kind:'journal_draft',title:'写给你的感谢',riskLevel:'L1',sourceIds:[],fields:{...blank,title:'写给你的感谢',body:'谢谢你陪我走过这些普通又珍贵的日子。',date:input.today,journalType:'信件'}}]}
  }
  else if(input.mode==='review')result={summary:`基于 ${input.sources.length} 条已确认资料：彼此都珍惜一起度过的普通时刻。`,selectedSkills:['relationship-review'],steps:[{skillId:'relationship-review',title:'来源化回顾',reason:'用户希望进行多轮关系回顾'}],proposals:[],followUpQuestion:'你最希望下一阶段一起保留什么习惯？',uncertainty:'只反映所选资料，不代表关系全貌。'}
  else if(input.mode==='followup')result={summary:'发现一个临近计划，可以建立提醒并准备关怀邮件草稿。',selectedSkills:['plan-follow-up','email-draft'],steps:[{skillId:'plan-follow-up',title:'检查临近计划',reason:'计划需要持续跟进'},{skillId:'email-draft',title:'准备关怀草稿',reason:'用户可选择是否交给邮件客户端'}],proposals:[{kind:'plan_draft',title:'面试前提醒',riskLevel:'L1',sourceIds,fields:{...blank,title:'面试前给一句鼓励',date:input.plans[0]?.date??input.today,time:input.plans[0]?.time??'09:00',planKind:'提醒',reminderMinutes:30}},{kind:'email_draft',title:'关怀邮件草稿',riskLevel:'L3',sourceIds,fields:{...blank,subject:'明天加油',body:'准备了这么久，明天一定会顺利。'}}],followUpQuestion:'',uncertainty:''}
  else if(input.mode==='discover')result={summary:'发现一条值得核对的新导入，已准备回忆草稿。',selectedSkills:['discover-imports'],steps:[{skillId:'discover-imports',title:'整理新导入',reason:'从明确选择的待确认来源生成草稿'}],proposals:[{kind:'memory_draft',title:'一起看到的海边日落',riskLevel:'L1',sourceIds,fields:{...blank,title:'一起看到的海边日落',body:input.sources[0]?.body??'一起去了海边。',date:input.sources[0]?.date??input.today}}],followUpQuestion:'',uncertainty:'保存前请核对人物和日期。'}
  else result={summary:'已把所选内容编排为回忆、计划和日历草稿，等待逐项确认。',selectedSkills:['image-to-memory-plan','calendar-draft'],steps:[{skillId:'image-to-memory-plan',title:'整理所选内容',reason:'从明确选择的来源生成草稿'},{skillId:'calendar-draft',title:'准备日历草稿',reason:'图片文字包含未来安排'}],proposals:[{kind:'memory_draft',title:'一起看到的海边日落',riskLevel:'L1',sourceIds,fields:{...blank,title:'一起看到的海边日落',body:input.sources[0]?.body??'一起去了海边。',date:input.sources[0]?.date??input.today}},{kind:'plan_draft',title:'下次一起去海边',riskLevel:'L2',sourceIds,fields:{...blank,title:'下次一起去海边',date:input.today,time:'18:00',planKind:'计划',reminderMinutes:60}},{kind:'calendar_draft',title:'海边计划日历草稿',riskLevel:'L3',sourceIds,fields:{...blank,title:'一起去海边',date:input.today,time:'18:00',description:'由青鸟 Agent 生成的日历草稿'}}],followUpQuestion:'',uncertainty:'日期来自当前任务基准日，保存前请核对。'}
 }
 else if(body.text.format.name==='quexin_candidates'){
  const first=input.lines[0]
  result=text.includes('invalid schema')?{candidates:[{title:12}]}:{candidates:[{title:'模型整理的候选',body:first.text,kind:'回忆',date:input.baseDate,sensitive:false,sourceLine:first.line}]}
 }else if(text.includes('invalid citation'))result={answer:'引用越界',citationIds:['outside-source'],uncertainty:''}
 else if(text.includes('invalid schema'))result={answer:42,citationIds:[],uncertainty:''}
 else result={answer:`根据已确认资料：${input.sources[0]?.title??input.plans[0]?.title??'没有依据'}。`,citationIds:input.sources[0]?[input.sources[0].id]:[],uncertainty:input.sources.length?'':'没有可引用记录'}
 const output=JSON.stringify(result),middle=Math.ceil(output.length/2)
 event(res,{type:'response.output_text.delta',delta:output.slice(0,middle)});setTimeout(()=>{if(!res.destroyed){event(res,{type:'response.output_text.delta',delta:output.slice(middle)});event(res,{type:'response.completed',response:{}});res.end()}},30)
}).listen(port,'127.0.0.1',()=>console.log(`fake model http://127.0.0.1:${port}`))
