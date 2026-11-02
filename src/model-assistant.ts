import type {PlanItem,RecordItem,RecordKind} from './domain'
import type {AgentProposalFields,AgentProposalKind,AgentRisk,AgentSkillId} from './agent-skills'

export type AssistantModelConfig={enabled:boolean;ocrEnabled:boolean;transcriptionEnabled:boolean;provider:string;model:string;transcriptionModel:string;timeoutMs:number;maxSources:number;maxSourceChars:number}
export type AssistantAdminConfig={available:boolean;enabled:boolean;provider:'deepseek'|'openai-compatible';providerName:string;apiUrl:string;model:string;transcriptionModel:string;hasApiKey:boolean;ocrEnabled:boolean;transcriptionEnabled:boolean;restarting?:boolean}
export type ModelAnswer={answer:string;citationIds:string[];uncertainty:string}
export type ModelCandidate={title:string;body:string;kind:RecordKind;date:string;sensitive:boolean;sourceLine:number}
export type ModelCreativeDraft={title:string;body:string;citationIds:string[];uncertainty:string}
export type ConversationResult={reply:string;suggestedCommands:string[];uncertainty:string}
export type AgentPlanningResult={summary:string;selectedSkills:AgentSkillId[];steps:Array<{skillId:AgentSkillId;title:string;reason:string}>;proposals:Array<{kind:AgentProposalKind;title:string;riskLevel:AgentRisk;sourceIds:string[];fields:Required<AgentProposalFields>}>;followUpQuestion:string;uncertainty:string}
export type AssistantStreamEvent={type:'status'|'progress';stage?:string;chars?:number;model?:string}
export class ModelAssistantError extends Error{constructor(readonly code:string,message:string){super(message);this.name='ModelAssistantError'}}

export async function getAssistantModelConfig():Promise<AssistantModelConfig>{
 const response=await fetch('/formal/v1/assistant/config',{credentials:'include',cache:'no-store'})
 const envelope=await response.json().catch(()=>null)
 if(!response.ok||!envelope?.ok)throw new ModelAssistantError(envelope?.error?.code??'MODEL_CONFIG_ERROR',envelope?.error?.message??'无法读取模型配置')
 return envelope.data
}
export async function getAssistantAdminConfig():Promise<AssistantAdminConfig>{
 const response=await fetch('/formal/v1/admin/assistant-config',{credentials:'include',cache:'no-store'})
 const envelope=await response.json().catch(()=>null)
 if(!response.ok||!envelope?.ok)throw new ModelAssistantError(envelope?.error?.code??'MODEL_CONFIG_ERROR',envelope?.error?.message??'无法读取 API 配置')
 return envelope.data
}
export async function updateAssistantAdminConfig(input:{enabled:boolean;provider:'deepseek'|'openai-compatible';apiUrl:string;apiKey:string;model:string;transcriptionModel:string;currentPassword:string}):Promise<AssistantAdminConfig>{
 const response=await fetch('/formal/v1/admin/assistant-config',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(input),credentials:'include',cache:'no-store'})
 const envelope=await response.json().catch(()=>null)
 if(!response.ok||!envelope?.ok)throw new ModelAssistantError(envelope?.error?.code??'MODEL_CONFIG_ERROR',envelope?.error?.message??'无法保存 API 配置')
 return envelope.data
}
async function stream<T>(path:string,input:unknown,signal:AbortSignal,onEvent?:(event:AssistantStreamEvent)=>void):Promise<T>{
 let response:Response
 try{response=await fetch(`/formal/v1/assistant/${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input),credentials:'include',cache:'no-store',signal})}
 catch(error){if(signal.aborted)throw new ModelAssistantError('MODEL_CANCELLED','请求已取消');throw new ModelAssistantError('MODEL_NETWORK','无法连接青鸟模型服务')}
 if(!response.ok){const envelope=await response.json().catch(()=>null);throw new ModelAssistantError(envelope?.error?.code??'MODEL_HTTP_ERROR',envelope?.error?.message??`请求失败：${response.status}`)}
 if(!response.body)throw new ModelAssistantError('MODEL_EMPTY','模型服务没有返回内容')
 const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',result:T|undefined
 while(true){const read=await reader.read();if(read.done)break;buffer+=decoder.decode(read.value,{stream:true}).replaceAll('\r\n','\n');let split
  while((split=buffer.indexOf('\n\n'))>=0){const packet=buffer.slice(0,split);buffer=buffer.slice(split+2);let event='message',data='';for(const line of packet.split('\n')){if(line.startsWith('event:'))event=line.slice(6).trim();if(line.startsWith('data:'))data+=line.slice(5).trim()}if(!data)continue;const value=JSON.parse(data)
   if(event==='error')throw new ModelAssistantError(value.code??'MODEL_FAILED',value.message??'模型处理失败')
   if(event==='result')result=value as T
   if(event==='status'||event==='progress')onEvent?.({type:event,...value})
  }
 }
 if(result===undefined)throw new ModelAssistantError('MODEL_EMPTY','模型服务没有返回最终结果')
 return result
}
export const askAssistantModel=(input:{consent:true;question:string;sources:Array<Pick<RecordItem,'id'|'title'|'body'|'date'|'kind'|'status'|'sensitive'>&{mediaScope?:'shared';sourceLabel?:string}>;plans:Array<Pick<PlanItem,'id'|'title'|'date'|'time'|'kind'|'status'>>},signal:AbortSignal,onEvent?:(event:AssistantStreamEvent)=>void)=>stream<ModelAnswer>('chat',{operation:'question',payload:input},signal,onEvent)
export const generateModelCandidates=(input:{consent:true;baseDate:string;selfName:string;partnerName:string;lines:Array<{line:number;text:string}>},signal:AbortSignal,onEvent?:(event:AssistantStreamEvent)=>void)=>stream<{candidates:ModelCandidate[]}>('candidates',input,signal,onEvent)
export const generateCreativeDraft=(input:{consent:true;type:'信件'|'日常'|'年度回顾';instruction:string;sources:Array<Pick<RecordItem,'id'|'title'|'body'|'date'|'kind'|'status'|'sensitive'>&{mediaScope?:'shared'}>},signal:AbortSignal,onEvent?:(event:AssistantStreamEvent)=>void)=>stream<ModelCreativeDraft>('creative',input,signal,onEvent)
export const chatAssistantModel=(input:{consent:true;message:string;conversation:Array<{role:'user'|'assistant';text:string}>},signal:AbortSignal,onEvent?:(event:AssistantStreamEvent)=>void)=>stream<ConversationResult>('chat',{operation:'conversation',payload:input},signal,onEvent)
export const runAssistantAgent=(input:{consent:true;mode:'command'|'discover'|'image'|'followup'|'review'|'custom';goal:string;today:string;availableSkills:AgentSkillId[];sources:Array<Pick<RecordItem,'id'|'title'|'body'|'date'|'kind'|'status'|'sensitive'>&{sourceLabel:string}>;plans:Array<Pick<PlanItem,'id'|'title'|'date'|'time'|'kind'|'status'>>;conversation:Array<{role:'user'|'assistant';text:string}>},signal:AbortSignal,onEvent?:(event:AssistantStreamEvent)=>void)=>stream<AgentPlanningResult>('chat',{operation:'agent',payload:input},signal,onEvent)

async function recognize(path:'ocr'|'transcribe',file:File,signal:AbortSignal):Promise<{text:string;method:string}>{
 let response:Response
 try{response=await fetch(`/formal/v1/import/${path}`,{method:'POST',headers:{'content-type':file.type,'x-file-name':encodeURIComponent(file.name),'x-quexin-consent':'true'},body:file,credentials:'include',cache:'no-store',signal})}
 catch{throw new ModelAssistantError(signal.aborted?'RECOGNITION_CANCELLED':'RECOGNITION_NETWORK',signal.aborted?'识别已取消':'无法连接识别服务')}
 const envelope=await response.json().catch(()=>null);if(!response.ok||!envelope?.ok)throw new ModelAssistantError(envelope?.error?.code??'RECOGNITION_FAILED',envelope?.error?.message??'识别失败')
 return envelope.data
}
export const recognizeImage=(file:File,signal:AbortSignal)=>recognize('ocr',file,signal)
export const transcribeAudio=(file:File,signal:AbortSignal)=>recognize('transcribe',file,signal)
