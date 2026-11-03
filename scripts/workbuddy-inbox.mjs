import {parseArgs} from 'node:util'
import {dirname,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {configureInbox,WorkBuddyInbox,watchInbox} from '../server/lib/workbuddy-inbox.mjs'
import {inboxError} from '../shared/workbuddy-chat-files.mjs'

const projectRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const usage=`鹊信 WorkBuddy 文件夹交接（F3）
  configure --inbox <项目外的交换箱> --owner-id <账号ID> --space-id <空间ID> --yes
  status | scan | watch --owner-id <账号ID> --space-id <空间ID>
  approve --owner-id <账号ID> --space-id <空间ID> --batch-id <批次ID> --digest <scan给出的SHA> [--archive] --yes
  retry --owner-id <账号ID> --space-id <空间ID> --batch-id <批次ID> --yes
  archive-stats --owner-id <账号ID> --space-id <空间ID>
  search --owner-id <账号ID> --space-id <空间ID> --conversation-id <会话ID> [--query <关键词>] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--sender-id <发送者ID>] [--limit 30] [--cursor <分页游标>]
  message --owner-id <账号ID> --space-id <空间ID> --conversation-id <会话ID> --message-id <消息ID>
可选：--data-root <本机服务状态目录>，configure --disabled 停用。
configure 仅授权发现清单；approve 授权本地校验，加 --archive 才允许建立本地归档。ready 为校验通过，completed 为归档完成。search 返回相关片段，message 返回指定原文及来源；青鸟界面将在 F4 接入。`

async function main(){
 const action=process.argv[2]??'help'
 if(['help','--help','-h'].includes(action)){console.log(usage);return}
 const {values}=parseArgs({args:process.argv.slice(3),strict:true,options:{inbox:{type:'string'},'data-root':{type:'string'},'owner-id':{type:'string'},'space-id':{type:'string'},'batch-id':{type:'string'},digest:{type:'string'},yes:{type:'boolean'},disabled:{type:'boolean'},archive:{type:'boolean'},'conversation-id':{type:'string'},'message-id':{type:'string'},query:{type:'string'},'sender-id':{type:'string'},from:{type:'string'},to:{type:'string'},limit:{type:'string'},cursor:{type:'string'}}})
 const options={dataRoot:resolve(values['data-root']??process.env.QUEXIN_LOCAL_DATA??resolve(projectRoot,'.local-data')),projectRoot,ownerId:values['owner-id'],spaceId:values['space-id']}
 if(['configure','approve','retry'].includes(action)&&!values.yes){console.log(JSON.stringify({ok:false,error:{code:'CONFIRM_REQUIRED',message:'检查参数后添加 --yes；当前没有写入或读取批次正文'}}));process.exitCode=2;return}
 if(action==='configure'){const config=await configureInbox({...options,inboxRoot:values.inbox,enabled:!values.disabled});console.log(JSON.stringify({ok:true,enabled:config.enabled,ownerId:config.ownerId,spaceId:config.spaceId}));return}
 const inbox=new WorkBuddyInbox(options)
 let result
 if(action==='status')result=await inbox.status()
 else if(action==='scan')result=await inbox.synchronize()
 else if(action==='approve')result={ok:true,...await inbox.approve(values['batch-id'],values.digest,{archive:values.archive})}
 else if(action==='retry')result={ok:true,...await inbox.retry(values['batch-id'])}
 else if(action==='archive-stats')result={ok:true,...await inbox.queryArchive('stats')}
 else if(action==='search')result={ok:true,...await inbox.queryArchive('search',{conversationId:values['conversation-id'],query:values.query,senderId:values['sender-id'],from:values.from,to:values.to,limit:values.limit===undefined?30:Number(values.limit),cursor:values.cursor})}
 else if(action==='message')result={ok:true,data:await inbox.queryArchive('message',{conversationId:values['conversation-id'],messageId:values['message-id']})}
 else if(action==='watch'){
  let previous='';const stop=watchInbox(inbox,{onResult:value=>{const summary=JSON.stringify({ok:value.ok,health:value.health.status,error:value.health.error,batches:value.batches.map(item=>({batchId:item.batchId,status:item.status,counts:item.counts,error:item.error}))});if(summary!==previous){previous=summary;console.log(summary)}}})
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{stop()})
  return
 }else throw new Error('invalid action')
 console.log(JSON.stringify(result,null,2));if(!result.ok)process.exitCode=1
}
main().catch(error=>{console.error(JSON.stringify({ok:false,error:inboxError(error)}));process.exitCode=1})
