// Node-only filesystem boundary shared by the producer and inbox consumer.
import {constants} from 'node:fs'
import {lstat,mkdir,open,realpath,rename,unlink} from 'node:fs/promises'
import {dirname,isAbsolute,join,relative,resolve,sep} from 'node:path'
import {homedir} from 'node:os'
import {randomUUID} from 'node:crypto'

const messages={UNSAFE_PATH:'目录或文件路径不安全',UNSAFE_FILE:'只接受普通目录和单链接文件',PERMISSION_DENIED:'目录须为 0700，文件须为 0600，且归当前用户所有',FILE_LIMIT:'文件超过读取上限',FILE_CHANGED:'校验期间文件发生变化，请重新投递',INVALID_JSON:'文件不是有效 JSON',INBOX_UNAVAILABLE:'交换箱暂时不可访问',BUSY:'另一个收件箱操作正在运行',INVALID_MANIFEST:'批次清单不符合交接协议',INVALID_MESSAGE:'消息字段、顺序或引用无效',HASH_MISMATCH:'文件 SHA-256 不匹配',SIZE_MISMATCH:'文件大小与清单不符',MEDIA_INVALID:'图片格式或内容损坏',MISSING_FILE:'清单列出的文件缺失',UNEXPECTED_FILE:'批次含清单外文件',BATCH_CONFLICT:'同一批次 ID 的内容已经改变',APPROVAL_REQUIRED:'请先确认这份批次清单',STATE_INVALID:'收件箱状态损坏，已停止处理',NOT_CONFIGURED:'尚未配置交换箱'}
Object.assign(messages,{ARCHIVE_UNAVAILABLE:'本地聊天归档暂时不可用',ARCHIVE_TIMEOUT:'归档操作超时，可重新尝试',INVALID_QUERY:'检索条件或分页参数无效',MESSAGE_CONFLICT:'同一消息 ID 对应不同内容，批次已停止写入',CANCELLED:'操作已取消',ARCHIVE_APPROVAL_REQUIRED:'该批次尚未获准建立本地聊天归档'})
export class InboxError extends Error {
 constructor(code,file){const known=Object.hasOwn(messages,code);super(known?messages[code]:'收件箱处理失败');this.name='InboxError';this.code=known?code:'INBOX_UNAVAILABLE';if(file&&safeChatPath(file))this.file=file}
}
export const inboxError=(error)=>({code:error instanceof InboxError?error.code:'INBOX_UNAVAILABLE',message:error instanceof InboxError?error.message:messages.INBOX_UNAVAILABLE,...(error instanceof InboxError&&error.file?{file:error.file}:{})})
export const chatId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)
export const safeChatPath=value=>typeof value==='string'&&value.length<=240&&!/[\\:\x00-\x1f\x7f]/.test(value)&&!value.startsWith('/')&&value.split('/').every(part=>part&&part!=='.'&&part!=='..')
export const containsPath=(root,path)=>{const rel=relative(root,path);return rel===''||(!rel.startsWith('..'+sep)&&rel!=='..'&&!isAbsolute(rel))}
// macOS standard aliases are canonicalized; user-created symbolic links are refused.
export function absoluteChatPath(path){
 if(typeof path!=='string'||!isAbsolute(path)||/[\x00-\x1f]/.test(path))throw new InboxError('UNSAFE_PATH')
 let value=resolve(path)
 if(process.platform==='darwin')for(const prefix of ['/tmp','/var'])if(value===prefix||value.startsWith(prefix+'/'))value='/private'+value
 return value
}
export async function checkedPath(path,{kind='directory',privateMode=false}={}){
 const absolute=absoluteChatPath(path),parts=absolute.split(sep).filter(Boolean);let current=sep,info
 for(let i=0;i<parts.length;i++){
  current=join(current,parts[i]);info=await lstat(current)
  if(info.isSymbolicLink()||(i<parts.length-1&&!info.isDirectory()))throw new InboxError('UNSAFE_PATH')
 }
 if(!info||(kind==='directory'?!info.isDirectory():!info.isFile()||info.nlink!==1))throw new InboxError('UNSAFE_FILE')
 if(privateMode&&((info.mode&0o777)!==(kind==='directory'?0o700:0o600)||(process.getuid&&info.uid!==process.getuid())))throw new InboxError('PERMISSION_DENIED')
 if(await realpath(absolute)!==absolute)throw new InboxError('UNSAFE_PATH')
 return info
}
export async function privateDirectory(path){
 const absolute=absoluteChatPath(path)
 try{await checkedPath(absolute,{privateMode:true});return absolute}catch(error){if(error.code!=='ENOENT')throw error}
 // Newly created parents are private too; existing ancestors are left unchanged.
 try{await checkedPath(dirname(absolute))}catch(error){if(error.code!=='ENOENT')throw error;await privateDirectory(dirname(absolute))}
 try{await mkdir(absolute,{mode:0o700})}catch(error){if(error.code!=='EEXIST')throw error}
 await checkedPath(absolute,{privateMode:true});return absolute
}
export async function readChatFile(root,file,maximum,{privateMode=true}={}){
 if(!safeChatPath(file))throw new InboxError('UNSAFE_PATH')
 root=absoluteChatPath(root);await checkedPath(root,{privateMode})
 let parent=root;for(const component of file.split('/').slice(0,-1)){parent=join(parent,component);await checkedPath(parent,{privateMode})}
 const path=join(root,file);let handle
 try{
  const before=await checkedPath(path,{kind:'file',privateMode})
  if(before.size>maximum)throw new InboxError('FILE_LIMIT',file)
  handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK)
  const opened=await handle.stat();if(opened.ino!==before.ino||opened.dev!==before.dev||!opened.isFile())throw new InboxError('FILE_CHANGED',file)
  const chunks=[];let bytes=0
  for await(const chunk of handle.createReadStream({autoClose:false})){bytes+=chunk.length;if(bytes>maximum)throw new InboxError('FILE_LIMIT',file);chunks.push(chunk)}
  const after=await handle.stat(),current=await checkedPath(path,{kind:'file',privateMode})
  if(before.size!==bytes||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs||current.ino!==before.ino||current.dev!==before.dev||current.ctimeMs!==before.ctimeMs)throw new InboxError('FILE_CHANGED',file)
  return Buffer.concat(chunks)
 }catch(error){if(error.code==='ENOENT')throw new InboxError('MISSING_FILE',file);throw error}finally{await handle?.close()}
}
export function parseChatJson(bytes){try{return JSON.parse(bytes.toString('utf8'))}catch{throw new InboxError('INVALID_JSON')}}
export async function atomicPrivateJson(root,file,value){
 if(!safeChatPath(file)||file.includes('/'))throw new InboxError('UNSAFE_PATH')
 await checkedPath(root,{privateMode:true})
 const temp=join(root,`.write-${randomUUID()}`);let handle
 try{handle=await open(temp,'wx',0o600);await handle.writeFile(JSON.stringify(value)+'\n');await handle.sync();await handle.close();handle=null;await rename(temp,join(root,file))}finally{await handle?.close();await unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error})}
}
export function assertExternalInbox(path,projectRoot){
 const root=absoluteChatPath(path),project=absoluteChatPath(projectRoot),home=absoluteChatPath(homedir())
 if(root===sep||root.split(sep).filter(Boolean).length<3||containsPath(root,home)||containsPath(root,project)||containsPath(project,root))throw new InboxError('UNSAFE_PATH')
 return root
}
