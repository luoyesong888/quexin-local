import type {RecordKind} from './domain'
export type ChatScope={ownerId:string;spaceId:string}
export type ChatRef={conversationId:string;messageId:string}
export type ChatExcerpt=ChatRef&{senderLabel:string;timestamp:string;text:string;truncated:boolean;source:{batchId:string;sequence:number;chunkFile:string;chunkLine:number;manifestDigest:string;extractorVersion:string}}
export type ChatBatch={batchId:string;digest?:string;status:string;counts?:{messages:number;media:number};summary?:{conversationId:string;participants:Array<{id:string;label:string}>;range:{from:string;to:string};timezone:string};error?:{code:string;message:string};receipt?:{added:number;duplicates:number}}
export type ChatStatus={scope:ChatScope;health:{status:string;error?:{code:string;message:string}};batches:ChatBatch[];stats:{messages:number;conversations:Array<{conversationId:string;messages:number}>};model:{enabled:boolean;provider:string;model:string;maxSources:number}}
export type ChatSearchItem=ChatRef&{senderLabel:string;timestamp:string;snippet:string;truncated:boolean;mediaCount:number;provenance:{batchId:string;sequence:number}}
export type ChatSearch={items:ChatSearchItem[];nextCursor:string|null}
export type ChatOriginal=ChatRef&{senderLabel:string;timestamp:string;text:string;sources:ChatExcerpt['source'][]}
export type ChatPreview={previewId:string;digest:string;excerpts:ChatExcerpt[];lines:Array<{line:number;text:string}>;expiresAt:number;model:ChatStatus['model']}
export type ChatCandidate={id:string;title:string;body:string;kind:RecordKind;date:string;sensitive:true;excerpt:ChatExcerpt}
export const workbuddyIntent=(text:string)=>/workbuddy|workbody|交换箱|聊天归档|聊天记录|这些聊天|聊天片段/i.test(text)
export async function chatRequest<T>(action:string,accountId:string,body:object={},signal?:AbortSignal):Promise<T>{
 const response=await fetch(`/formal/v1/workbuddy/${action}`,{method:'POST',credentials:'include',cache:'no-store',headers:{'content-type':'application/json'},body:JSON.stringify({expectedOwnerId:accountId,...body}),signal})
 const envelope=await response.json().catch(()=>null)
 if(!response.ok||!envelope?.ok)throw new Error(envelope?.error?.message??'无法连接本机聊天资料服务。')
 return envelope.data
}
