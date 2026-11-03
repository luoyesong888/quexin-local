import {createHash} from 'node:crypto'
import {InboxError} from './workbuddy-chat-files.mjs'

export const WORKBUDDY_CHAT_SOURCE_TYPE='workbuddy-chat'
export const digestText=value=>createHash('sha256').update(value).digest('hex')
export function chatContentHash(message){
 // Batch order, display names and attachment filenames are not message identity.
 const text=message.text.replace(/\[图片:[^\]]+\]/g,'[图片]').normalize('NFC')
 return digestText(JSON.stringify([message.conversationId,message.senderId,new Date(message.timestamp).toISOString(),text,message.mediaRefs.map(ref=>ref.sha256)]))
}
export function fallbackMessageId(message,occurrences){
 const hash=chatContentHash(message),rank=(occurrences.get(hash)??0)+1;occurrences.set(hash,rank)
 return `fallback-${hash}-${rank}`
}
export function archiveMessageId(message,extractorVersion,occurrences){
 const legacy=/^(?:workbuddy-legacy-adapter-1|workbuddy-folder-handoff-1)$/.test(extractorVersion)&&/^[a-f0-9]{64}$/.test(message.messageId)
 if(legacy||message.messageId.startsWith('fallback-')){
  const id=fallbackMessageId(message,occurrences)
  if(!legacy&&message.messageId!==id)throw new InboxError('INVALID_MESSAGE')
  return id
 }
 return message.messageId
}
