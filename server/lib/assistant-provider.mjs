import {z} from 'zod'

export class AssistantProviderError extends Error{
 constructor(code,message,status=502){super(message);this.name='AssistantProviderError';this.code=code;this.status=status}
}
const clamp=(value,min,max,fallback)=>{const n=Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,Math.floor(n))):fallback}
export function assistantProviderConfig(env=process.env){
 const provider=env.ASSISTANT_PROVIDER==='deepseek'?'deepseek':'openai-compatible',apiKey=env.ASSISTANT_API_KEY??env.OPENAI_API_KEY??'',model=env.ASSISTANT_MODEL??'',transcriptionModel=env.ASSISTANT_TRANSCRIPTION_MODEL??'',baseUrl=(env.ASSISTANT_API_URL??'https://api.openai.com/v1').replace(/\/+$/,'')
 const timeoutMs=clamp(env.ASSISTANT_TIMEOUT_MS,3_000,120_000,30_000),maxSources=clamp(env.ASSISTANT_MAX_SOURCES,1,12,6),maxSourceChars=clamp(env.ASSISTANT_MAX_SOURCE_CHARS,300,4_000,1_800)
 const enabled=Boolean(apiKey&&model&&!apiKey.startsWith('replace-with-')&&!model.startsWith('replace-with-'))
 const ocrEnabled=Boolean(enabled&&(provider!=='deepseek'||model==='deepseek-flash')),transcriptionEnabled=Boolean(provider!=='deepseek'&&apiKey&&transcriptionModel&&!apiKey.startsWith('replace-with-')&&!transcriptionModel.startsWith('replace-with-'))
 return{enabled,ocrEnabled,transcriptionEnabled,provider,apiKey,model,transcriptionModel,baseUrl,timeoutMs,maxSources,maxSourceChars,public:{enabled,ocrEnabled,transcriptionEnabled,provider:provider==='deepseek'?'DeepSeek Responses API':'OpenAI Responses API',model:enabled?model:'',transcriptionModel:transcriptionEnabled?transcriptionModel:'',timeoutMs,maxSources,maxSourceChars}}
}
const sourceSchema=z.object({id:z.string().min(1).max(160),title:z.string().min(1).max(160),body:z.string().max(4_000),date:z.string().max(20),kind:z.enum(['回忆','心愿','计划','偏好']),status:z.literal('confirmed'),sensitive:z.literal(false),mediaScope:z.literal('shared').optional(),sourceLabel:z.string().max(240).optional()}).strict()
export const agentSkillIds=['command-inbox','personal-memory','personal-planner','personal-journal','discover-imports','image-to-memory-plan','plan-follow-up','calendar-draft','email-draft','relationship-review']
export const productToolIds=['open-page','pet-touch','pet-feed','pet-rest','pet-wake','change-theme','toggle-care','toggle-pet','export-backup','export-museum']
const agentSkillSchema=z.enum(agentSkillIds),agentSourceSchema=z.object({id:z.string().min(1).max(160),title:z.string().min(1).max(160),body:z.string().max(4_000),date:z.string().max(20),kind:z.enum(['回忆','心愿','计划','偏好']),status:z.enum(['confirmed','pending']),sensitive:z.literal(false),sourceLabel:z.string().max(240)}).strict()
const planSchema=z.object({id:z.string().min(1).max(160),title:z.string().min(1).max(160),date:z.string().max(20),time:z.string().max(20),kind:z.enum(['心愿','计划','待办','提醒','纪念日']),status:z.enum(['todo','done','cancelled'])}).strict()
export const answerInputSchema=z.object({consent:z.literal(true),question:z.string().trim().min(1).max(1_000),sources:z.array(sourceSchema).max(12),plans:z.array(planSchema).max(12)}).strict()
export const candidateInputSchema=z.object({consent:z.literal(true),baseDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),selfName:z.string().min(1).max(30),partnerName:z.string().min(1).max(30),lines:z.array(z.object({line:z.number().int().min(1).max(100_000),text:z.string().min(1).max(2_000)}).strict()).min(1).max(40)}).strict()
export const creativeInputSchema=z.object({consent:z.literal(true),type:z.enum(['信件','日常','年度回顾']),instruction:z.string().trim().min(1).max(1000),sources:z.array(sourceSchema).min(1).max(12)}).strict()
export const conversationInputSchema=z.object({consent:z.literal(true),message:z.string().trim().min(1).max(2000),conversation:z.array(z.object({role:z.enum(['user','assistant']),text:z.string().min(1).max(4000)}).strict()).max(10)}).strict()
export const agentInputSchema=z.object({consent:z.literal(true),mode:z.enum(['command','discover','image','followup','review','custom']),goal:z.string().trim().min(1).max(1200),today:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),availableSkills:z.array(agentSkillSchema).min(1).max(10),sources:z.array(agentSourceSchema).max(12),plans:z.array(planSchema).max(12),conversation:z.array(z.object({role:z.enum(['user','assistant']),text:z.string().min(1).max(4000)}).strict()).max(12)}).strict()
const answerOutput=z.object({answer:z.string().min(1).max(6_000),citationIds:z.array(z.string().max(160)).max(12),uncertainty:z.string().max(1_000)}).strict()
const candidateOutput=z.object({candidates:z.array(z.object({title:z.string().min(1).max(160),body:z.string().min(1).max(4_000),kind:z.enum(['回忆','心愿','计划','偏好']),date:z.string().max(20),sensitive:z.boolean(),sourceLine:z.number().int()}).strict()).max(20)}).strict()
const creativeOutput=z.object({title:z.string().min(1).max(160),body:z.string().min(1).max(12_000),citationIds:z.array(z.string().max(160)).max(12),uncertainty:z.string().max(1000)}).strict()
const conversationOutput=z.object({reply:z.string().min(1).max(6000),suggestedCommands:z.array(z.string().min(1).max(240)).max(4),uncertainty:z.string().max(1000)}).strict()
const agentFields=z.object({title:z.string().max(160),body:z.string().max(6000),date:z.string().max(20),time:z.string().max(20),recordKind:z.enum(['回忆','心愿','计划','偏好']),planKind:z.enum(['心愿','计划','待办','提醒','纪念日']),journalType:z.enum(['信件','日常','年度回顾']),recurrence:z.enum(['none','daily','weekly','monthly','yearly']),recurrenceUntil:z.string().max(20),reminderMinutes:z.number().int().min(0).max(10080),careNeed:z.enum(['想安静','想聊聊','想被听见','一起想办法']),description:z.string().max(2000),subject:z.string().max(200),recipient:z.string().max(320),productTool:z.enum(productToolIds),toolTarget:z.string().max(120),toolValue:z.string().max(240)}).strict()
const agentOutput=z.object({summary:z.string().min(1).max(6000),selectedSkills:z.array(agentSkillSchema).min(1).max(10),steps:z.array(z.object({skillId:agentSkillSchema,title:z.string().min(1).max(160),reason:z.string().max(1000)}).strict()).min(1).max(12),proposals:z.array(z.object({kind:z.enum(['memory_draft','plan_draft','journal_draft','care_draft','calendar_draft','email_draft','product_action']),title:z.string().min(1).max(160),riskLevel:z.enum(['L0','L1','L2','L3']),sourceIds:z.array(z.string().max(160)).max(12),fields:agentFields}).strict()).max(10),followUpQuestion:z.string().max(1000),uncertainty:z.string().max(1000)}).strict()
const answerJsonSchema={type:'object',additionalProperties:false,properties:{answer:{type:'string'},citationIds:{type:'array',items:{type:'string'}},uncertainty:{type:'string'}},required:['answer','citationIds','uncertainty']}
const candidateJsonSchema={type:'object',additionalProperties:false,properties:{candidates:{type:'array',items:{type:'object',additionalProperties:false,properties:{title:{type:'string'},body:{type:'string'},kind:{type:'string',enum:['回忆','心愿','计划','偏好']},date:{type:'string'},sensitive:{type:'boolean'},sourceLine:{type:'integer'}},required:['title','body','kind','date','sensitive','sourceLine']}}},required:['candidates']}
const creativeJsonSchema={type:'object',additionalProperties:false,properties:{title:{type:'string'},body:{type:'string'},citationIds:{type:'array',items:{type:'string'}},uncertainty:{type:'string'}},required:['title','body','citationIds','uncertainty']}
const conversationJsonSchema={type:'object',additionalProperties:false,properties:{reply:{type:'string'},suggestedCommands:{type:'array',items:{type:'string'}},uncertainty:{type:'string'}},required:['reply','suggestedCommands','uncertainty']}
const agentFieldsJson={type:'object',additionalProperties:false,properties:{title:{type:'string'},body:{type:'string'},date:{type:'string'},time:{type:'string'},recordKind:{type:'string',enum:['回忆','心愿','计划','偏好']},planKind:{type:'string',enum:['心愿','计划','待办','提醒','纪念日']},journalType:{type:'string',enum:['信件','日常','年度回顾']},recurrence:{type:'string',enum:['none','daily','weekly','monthly','yearly']},recurrenceUntil:{type:'string'},reminderMinutes:{type:'integer'},careNeed:{type:'string',enum:['想安静','想聊聊','想被听见','一起想办法']},description:{type:'string'},subject:{type:'string'},recipient:{type:'string'},productTool:{type:'string',enum:productToolIds},toolTarget:{type:'string'},toolValue:{type:'string'}},required:['title','body','date','time','recordKind','planKind','journalType','recurrence','recurrenceUntil','reminderMinutes','careNeed','description','subject','recipient','productTool','toolTarget','toolValue']}
const agentJsonSchema={type:'object',additionalProperties:false,properties:{summary:{type:'string'},selectedSkills:{type:'array',items:{type:'string',enum:agentSkillIds}},steps:{type:'array',items:{type:'object',additionalProperties:false,properties:{skillId:{type:'string',enum:agentSkillIds},title:{type:'string'},reason:{type:'string'}},required:['skillId','title','reason']}},proposals:{type:'array',items:{type:'object',additionalProperties:false,properties:{kind:{type:'string',enum:['memory_draft','plan_draft','journal_draft','care_draft','calendar_draft','email_draft','product_action']},title:{type:'string'},riskLevel:{type:'string',enum:['L0','L1','L2','L3']},sourceIds:{type:'array',items:{type:'string'}},fields:agentFieldsJson},required:['kind','title','riskLevel','sourceIds','fields']}},followUpQuestion:{type:'string'},uncertainty:{type:'string'}},required:['summary','selectedSkills','steps','proposals','followUpQuestion','uncertainty']}

function outputText(response){
 if(typeof response?.output_text==='string')return response.output_text
 for(const item of response?.output??[])for(const content of item?.content??[])if(content?.type==='output_text'&&typeof content.text==='string')return content.text
 return''
}
async function readError(response){const text=await response.text();try{return JSON.parse(text)?.error?.message??text.slice(0,500)}catch{return text.slice(0,500)}}
async function streamedText(response,onProgress){
 if(!response.body)throw new AssistantProviderError('MODEL_EMPTY','模型没有返回可读取内容')
 const decoder=new TextDecoder();let buffer='',text='',refusal=''
 for await(const chunk of response.body){
  buffer+=decoder.decode(chunk,{stream:true}).replaceAll('\r\n','\n')
  let split
  while((split=buffer.indexOf('\n\n'))>=0){
   const packet=buffer.slice(0,split);buffer=buffer.slice(split+2)
   const data=packet.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trim()).join('\n')
   if(!data||data==='[DONE]')continue
   let event;try{event=JSON.parse(data)}catch{continue}
   if(event.type==='response.output_text.delta'){text+=String(event.delta??'');onProgress?.({type:'progress',chars:text.length})}
   if(event.type==='response.refusal.delta')refusal+=String(event.delta??'')
   if(event.type==='response.completed'&&!text)text=outputText(event.response)
   if(event.type==='error'||event.type==='response.failed')throw new AssistantProviderError('MODEL_FAILED',String(event.error?.message??event.response?.error?.message??'模型处理失败'))
  }
 }
 if(refusal)throw new AssistantProviderError('MODEL_REFUSED','模型拒绝了这次请求')
 return text
}
export class AssistantProvider{
 constructor(config=assistantProviderConfig()){this.config=config}
 publicConfig(){return this.config.public}
 async run(kind,input,{signal,onProgress}={}){
  if(!this.config.enabled)throw new AssistantProviderError('MODEL_NOT_CONFIGURED','尚未配置真实模型服务',503)
  const parsed=(kind==='answer'?answerInputSchema:kind==='creative'?creativeInputSchema:kind==='conversation'?conversationInputSchema:kind==='agent'?agentInputSchema:candidateInputSchema).safeParse(input)
  if(!parsed.success)throw new AssistantProviderError('VALIDATION_FAILED','发送给模型的资料范围无效',400)
  const value=parsed.data
  if((kind==='answer'||kind==='creative'||kind==='agent')&&value.sources.length>this.config.maxSources)throw new AssistantProviderError('SOURCE_LIMIT',`一次最多发送 ${this.config.maxSources} 条来源`,400)
  if(kind==='answer'||kind==='creative'||kind==='agent')value.sources=value.sources.map(source=>({...source,body:source.body.slice(0,this.config.maxSourceChars)}))
  const allowedIds=kind==='answer'||kind==='creative'||kind==='agent'?new Set(value.sources.map(source=>source.id)):null
  const schema=kind==='answer'?answerJsonSchema:kind==='creative'?creativeJsonSchema:kind==='conversation'?conversationJsonSchema:kind==='agent'?agentJsonSchema:candidateJsonSchema
  const instructions=kind==='answer'?'你是鹊信的青鸟助手。只能依据提供的已确认资料回答，不得补充资料中没有的事实。citationIds 只能引用输入 source 的 id；没有依据就明确说不知道。输出简体中文 JSON。':kind==='creative'?'你是鹊信的创作助手。根据用户指令和已确认资料起草文字，不得添加来源中没有的具体事实。citationIds 只能引用输入来源 id。语气温柔克制，输出简体中文 JSON 草稿，由用户继续编辑。':kind==='conversation'?'你是鹊信里的青鸟个人智能体。和用户自然、简洁地用简体中文对话。你只能看到本次 message 和提供的最近 conversation，不能访问或猜测用户的本地回忆、计划、伴侣信息、文件或账号状态。不要声称已经保存、提醒、发送、读取或执行任何动作；如果用户想执行动作，用 suggestedCommands 提供可再次发送的明确指令。遇到医疗、法律或关系裁决问题避免权威判断。输出 JSON。':kind==='agent'?'你是鹊信的青鸟个人 Agent 规划器。用户的 goal 是本次明确指令，即使 sources 和 plans 为空也可作为第一方来源生成草稿。只能从 availableSkills 选择最少且必要的技能；直接指令必须选择 command-inbox，再按目标选择 personal-memory、personal-planner 或 personal-journal。sourceIds 只能引用输入 sources 的 id，没有资料时保持空数组。把事实、建议和动作草稿分开。所有保存、计划、关怀、创作、日历和邮件都只能作为 proposal，绝不声称已执行。产品内导航、宠物互动、主题/模块切换和本地导出使用 product_action，productTool 只能从 Schema 白名单选择；删除账号、删除空间、恢复备份、密码/API Key 等高风险目标只能用 open-page 打开对应设置页，不得直接执行。周期目标填写 recurrence；日期不确定就留空并说明。不得选择微信或其他未提供 Skill，不得关系裁决、心理诊断、冒充伴侣或编造用户未说过的事实。邮件只写草稿。根据 conversation 支持多轮回顾。输出简体中文 JSON。':'你是鹊信的记录整理器。只从输入行提取候选，不得猜测人物、日期或事件。日期不确定时使用空字符串；sourceLine 必须来自输入行号。输出简体中文 JSON。'
  const body={model:this.config.model,store:false,stream:true,instructions,input:JSON.stringify(value),text:{format:{type:'json_schema',name:`quexin_${kind}`,strict:true,schema}}}
  const timeout=AbortSignal.timeout(this.config.timeoutMs),combined=signal?AbortSignal.any([signal,timeout]):timeout
  let response
  try{response=await fetch(`${this.config.baseUrl}/responses`,{method:'POST',headers:{authorization:`Bearer ${this.config.apiKey}`,'content-type':'application/json'},body:JSON.stringify(body),signal:combined})}
  catch(error){if(combined.aborted)throw new AssistantProviderError(signal?.aborted?'MODEL_CANCELLED':'MODEL_TIMEOUT',signal?.aborted?'请求已取消':'模型响应超时',signal?.aborted?499:504);throw new AssistantProviderError('MODEL_UNAVAILABLE','无法连接模型服务')}
  if(!response.ok)throw new AssistantProviderError('MODEL_HTTP_ERROR',`模型服务返回 ${response.status}：${await readError(response)}`,502)
  const raw=response.headers.get('content-type')?.includes('text/event-stream')?await streamedText(response,onProgress):outputText(await response.json())
  let json;try{json=JSON.parse(raw)}catch{throw new AssistantProviderError('MODEL_INVALID_OUTPUT','模型没有返回有效的结构化结果')}
  const result=(kind==='answer'?answerOutput:kind==='creative'?creativeOutput:kind==='conversation'?conversationOutput:kind==='agent'?agentOutput:candidateOutput).safeParse(json)
  if(!result.success)throw new AssistantProviderError('MODEL_INVALID_OUTPUT','模型返回结果未通过结构校验')
  if(kind==='answer'||kind==='creative'){
   const invalid=result.data.citationIds.filter(id=>!allowedIds.has(id));if(invalid.length)throw new AssistantProviderError('MODEL_INVALID_CITATION','模型引用了未发送的资料')
   result.data.citationIds=[...new Set(result.data.citationIds)]
  }else if(kind==='agent'){
   if(result.data.selectedSkills.some(id=>!value.availableSkills.includes(id))||result.data.steps.some(step=>!value.availableSkills.includes(step.skillId)))throw new AssistantProviderError('MODEL_INVALID_SKILL','模型选择了未提供的 Skill')
   if(result.data.steps.some(step=>!result.data.selectedSkills.includes(step.skillId)))throw new AssistantProviderError('MODEL_INVALID_SKILL','Agent 步骤没有对应已选择的 Skill')
   const proposalSkills={memory_draft:['personal-memory','discover-imports','image-to-memory-plan'],plan_draft:['personal-planner','image-to-memory-plan','plan-follow-up'],journal_draft:['personal-journal'],care_draft:['personal-journal'],calendar_draft:['calendar-draft'],email_draft:['email-draft'],product_action:['command-inbox']}
   if(result.data.proposals.some(proposal=>!proposalSkills[proposal.kind].some(id=>result.data.selectedSkills.includes(id))))throw new AssistantProviderError('MODEL_INVALID_SKILL','Agent 草稿没有对应已选择的 Skill')
   if(result.data.proposals.some(proposal=>proposal.sourceIds.some(id=>!allowedIds.has(id))))throw new AssistantProviderError('MODEL_INVALID_CITATION','Agent 草稿引用了未发送的资料')
   if(value.mode==='command'&&!result.data.selectedSkills.includes('command-inbox'))throw new AssistantProviderError('MODEL_INVALID_SKILL','直接指令必须经过指令收件箱 Skill')
   for(const proposal of result.data.proposals){if(proposal.fields.date&&!/^\d{4}-\d{2}-\d{2}$/.test(proposal.fields.date))throw new AssistantProviderError('MODEL_INVALID_OUTPUT','Agent 草稿日期格式无效');if(proposal.fields.recurrenceUntil&&!/^\d{4}-\d{2}-\d{2}$/.test(proposal.fields.recurrenceUntil))throw new AssistantProviderError('MODEL_INVALID_OUTPUT','Agent 周期结束日期格式无效');if(proposal.fields.time&&!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(proposal.fields.time))throw new AssistantProviderError('MODEL_INVALID_OUTPUT','Agent 草稿时间格式无效');if(proposal.kind==='product_action'&&proposal.fields.productTool==='open-page'&&!['today','import','memories','planner','care','nest','create','settings'].includes(proposal.fields.toolTarget))throw new AssistantProviderError('MODEL_INVALID_TOOL','产品页面目标不在白名单');if(proposal.kind==='product_action'&&proposal.fields.productTool==='change-theme'&&!['paper','ink','vivid','bamboo','cosmos','jade','sunlight','heritage','film','brocade'].includes(proposal.fields.toolValue))throw new AssistantProviderError('MODEL_INVALID_TOOL','主题不在白名单')}
  }else if(kind==='conversation'){
   result.data.suggestedCommands=[...new Set(result.data.suggestedCommands)].slice(0,4)
  }else{
   const lines=new Set(value.lines.map(line=>line.line));if(result.data.candidates.some(item=>!lines.has(item.sourceLine)))throw new AssistantProviderError('MODEL_INVALID_CITATION','模型候选引用了不存在的原文行')
   for(const item of result.data.candidates)if(item.date&&!/^\d{4}-\d{2}-\d{2}$/.test(item.date))throw new AssistantProviderError('MODEL_INVALID_OUTPUT','模型候选日期格式无效')
  }
  return result.data
 }
  async ocr({buffer,contentType,filename},{signal}={}){
   if(!this.config.ocrEnabled)throw new AssistantProviderError('OCR_NOT_CONFIGURED','尚未配置支持图片输入的识别模型',503)
   if(!['image/jpeg','image/png','image/webp','image/gif'].includes(contentType))throw new AssistantProviderError('VALIDATION_FAILED','OCR 仅支持 JPEG、PNG、WebP 或非动画 GIF',400)
   const body={model:this.config.model,store:false,stream:false,instructions:'读取图片中可见的聊天或笔记文字。保持原有消息顺序、人物称呼和日期，不要解释、补写或总结。无法辨认处使用 [无法辨认]。',input:[{role:'user',content:[{type:'input_text',text:`请转写文件 ${filename} 中的可见文字。`},{type:'input_image',image_url:`data:${contentType};base64,${buffer.toString('base64')}`,detail:'high'}]}],text:{format:{type:'json_schema',name:'quexin_ocr',strict:true,schema:{type:'object',additionalProperties:false,properties:{text:{type:'string'}},required:['text']}}}}
   const timeout=AbortSignal.timeout(this.config.timeoutMs),combined=signal?AbortSignal.any([signal,timeout]):timeout
   let response;try{response=await fetch(`${this.config.baseUrl}/responses`,{method:'POST',headers:{authorization:`Bearer ${this.config.apiKey}`,'content-type':'application/json'},body:JSON.stringify(body),signal:combined})}catch{throw new AssistantProviderError(combined.aborted?'OCR_TIMEOUT':'OCR_UNAVAILABLE',combined.aborted?'图片识别超时或已取消':'无法连接图片识别服务',combined.aborted?504:502)}
   if(!response.ok)throw new AssistantProviderError('OCR_HTTP_ERROR',`图片识别服务返回 ${response.status}：${await readError(response)}`)
   let parsed;try{parsed=JSON.parse(outputText(await response.json()))}catch{throw new AssistantProviderError('OCR_INVALID_OUTPUT','图片识别没有返回有效文字')}
   const result=z.object({text:z.string().min(1).max(100_000)}).strict().safeParse(parsed);if(!result.success)throw new AssistantProviderError('OCR_INVALID_OUTPUT','图片识别结果无效')
   return result.data
  }
  async transcribe({buffer,contentType,filename},{signal}={}){
   if(!this.config.transcriptionEnabled)throw new AssistantProviderError('TRANSCRIPTION_NOT_CONFIGURED','尚未配置录音转写模型',503)
   const allowed=['audio/flac','audio/mpeg','audio/mp4','audio/mpga','audio/m4a','audio/x-m4a','audio/ogg','audio/wav','audio/x-wav','audio/webm','video/mp4']
   if(!allowed.includes(contentType))throw new AssistantProviderError('VALIDATION_FAILED','录音格式不受支持',400)
   const form=new FormData();form.set('file',new Blob([buffer],{type:contentType}),filename);form.set('model',this.config.transcriptionModel);form.set('response_format','json')
   const timeout=AbortSignal.timeout(Math.max(this.config.timeoutMs,60_000)),combined=signal?AbortSignal.any([signal,timeout]):timeout
   let response;try{response=await fetch(`${this.config.baseUrl}/audio/transcriptions`,{method:'POST',headers:{authorization:`Bearer ${this.config.apiKey}`},body:form,signal:combined})}catch{throw new AssistantProviderError(combined.aborted?'TRANSCRIPTION_TIMEOUT':'TRANSCRIPTION_UNAVAILABLE',combined.aborted?'录音转写超时或已取消':'无法连接录音转写服务',combined.aborted?504:502)}
   if(!response.ok)throw new AssistantProviderError('TRANSCRIPTION_HTTP_ERROR',`录音转写服务返回 ${response.status}：${await readError(response)}`)
   const value=await response.json().catch(()=>null),result=z.object({text:z.string().min(1).max(100_000)}).passthrough().safeParse(value);if(!result.success)throw new AssistantProviderError('TRANSCRIPTION_INVALID_OUTPUT','录音转写结果无效')
   return{text:result.data.text}
  }
}
