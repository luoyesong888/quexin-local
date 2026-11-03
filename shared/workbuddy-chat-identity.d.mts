export const WORKBUDDY_CHAT_SOURCE_TYPE:'workbuddy-chat'
export type WorkBuddyChatSource={type:'workbuddy-chat';batchId:string;conversationId:string;messageId:string;sequence:number}
export type WorkBuddyChatSearchResult={items:Array<{messageId:string;conversationId:string;senderId:string;senderLabel:string;timestamp:string;date:string;snippet:string;truncated:boolean;mediaCount:number;provenance:WorkBuddyChatSource}>;nextCursor:string|null}
export function digestText(value:string):string
export function chatContentHash(message:import('./workbuddy-chat-contract.mjs').WorkBuddyChatMessage):string
export function fallbackMessageId(message:import('./workbuddy-chat-contract.mjs').WorkBuddyChatMessage,occurrences:Map<string,number>):string
export function archiveMessageId(message:import('./workbuddy-chat-contract.mjs').WorkBuddyChatMessage,extractorVersion:string,occurrences:Map<string,number>):string
