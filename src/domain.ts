import type { Dispatch, SetStateAction } from 'react'

export type ThemeId = 'paper' | 'ink' | 'vivid' | 'bamboo' | 'cosmos' | 'jade' | 'sunlight' | 'heritage' | 'film' | 'brocade'
export type PageId = 'today' | 'import' | 'memories' | 'planner' | 'care' | 'nest' | 'create' | 'settings'
export type RecordKind = '回忆' | '心愿' | '计划' | '偏好'
export type RecordProvenance = import('./import-source').RecordProvenance
export type AgentRun = import('./agent-skills').AgentRun
export type AssistantChatMessage = import('./agent-skills').AssistantChatMessage
export interface ImportDraft {step:1|2;tab:'text'|'file'|'wechat';text:string;baseDate:string;selfAlias:string;partnerAlias:string;checkedLines:number[];fileName:string;sourceType:RecordProvenance['type'];binaryRequired?:boolean;savedAt:string}
export interface RecordItem { id:string; title:string; body:string; date:string; kind:RecordKind; source:string; provenance?:RecordProvenance; needsDateReview?:boolean; image?:string; imageThumbnail?:string; mediaId?:string; mediaScope?:'shared'|'private'; status:'pending'|'confirmed'|'ignored'; sensitive?:boolean; entityVersion?:number; expectedVersion?:number }
export interface PlanItem { id:string; title:string; date:string; time:string; kind:'心愿'|'计划'|'待办'|'提醒'|'纪念日'; sourceRecordId?:string; sensitive?:boolean; timezone?:string; recurrence?:'none'|'daily'|'weekly'|'monthly'|'yearly'; recurrenceUntil?:string; reminderMinutes?:number|null; completedOccurrences?:string[]; status:'todo'|'done'|'cancelled'; entityVersion?:number; expectedVersion?:number }
export interface Journal { id:string; title:string; body:string; type:'信件'|'时光胶囊'|'日常'|'年度回顾'; date:string; unlockDate?:string; unlockAt?:string; sensitive?:boolean; entityVersion?:number; expectedVersion?:number }
export interface DemoStore {
  version:1;
  records:RecordItem[];
  plans:PlanItem[];
  journals:Journal[];
  pet:{name:string;energy:number;curiosity:number;comfort:number;feathers:number;room:'study'|'garden'|'cosmos';pose:'idle'|'happy'|'eat'|'sleep';log:string[]};
  settings:{theme:ThemeId;selfName:string;partnerName:string;since:string;aiMode:'demo'|'model'|'off';aiModelConsent?:boolean;wechatDemo:boolean;syncDemo:boolean;moduleCare:boolean;modulePet:boolean;reduceMotion:boolean;onboardingCompleted?:boolean;sampleMode?:boolean;boundSpaceId?:string;assistantChatVersion?:number};
  care:{need:string;shared:boolean;draft:string;followups:string[];cycleStart:string};
  agentRuns?:AgentRun[];
  assistantMessages?:AssistantChatMessage[];
  importDraft?:ImportDraft;
  logs:{id:string;time:string;text:string}[];
}
export interface PageProps {
  accountId?:string;
  openAssistant?:(request?:{command?:string;attachments?:boolean})=>void;
  assistantRequest?:{id:string;command?:string;attachments?:boolean};
  consumeAssistantRequest?:(id:string)=>void;
  openReview?:(file?:File)=>void;
  petAction?:(input:import('./companion-sync').PetActionInput)=>void;
  petGrowthSources?:Array<{sourceId:string;title:string;contribution:number;addedAt:string}>;
  store:DemoStore;
  setStore:Dispatch<SetStateAction<DemoStore>>;
  update:(fn:(store:DemoStore)=>DemoStore,message:string)=>void;
  notify:(message:string)=>void;
  go:(page:PageId,intent?:string)=>void;
  intent?:string;
}
export const themeOptions:{id:ThemeId;name:string;desc:string;colors:string[]}[] = [
  {id:'paper',name:'素笺朱砂',desc:'宣纸 · 朱红 · 温润书房',colors:['#f6f0e5','#a13b29','#dfc6a8']},
  {id:'ink',name:'墨白留声',desc:'黑白 · 留白 · 东方版式',colors:['#fafbf7','#171918','#d3252d']},
  {id:'vivid',name:'明快日常',desc:'宝蓝 · 明亮色块 · 活力',colors:['#f9faff','#0749e8','#ed401e']},
  {id:'bamboo',name:'竹影听风',desc:'水墨 · 竹青 · 山水',colors:['#f8faf8','#4f7059','#c5d6c6']},
  {id:'cosmos',name:'星河来信',desc:'深蓝 · 星光 · 未来感',colors:['#061521','#66e1f1','#173d53']},
  {id:'jade',name:'碧玉流光',desc:'翡翠 · 透光 · 自然',colors:['#edf3ed','#2f6758','#b7cfbb']},
  {id:'sunlight',name:'暖阳花序',desc:'奶油 · 薰衣草 · 午后',colors:['#faf7f1','#80709f','#e5ccae']},
  {id:'heritage',name:'松墨鎏金',desc:'墨绿 · 黄铜 · 典藏',colors:['#f0e7d5','#1e382c','#b28b50']},
  {id:'film',name:'胶片手账',desc:'暖黑 · 胶片 · 拼贴',colors:['#e9e5da','#363129','#b88757']},
  {id:'brocade',name:'山海织锦',desc:'青黛 · 陶橘 · 国风',colors:['#f5ead8','#15545d','#b84a2b']},
]
