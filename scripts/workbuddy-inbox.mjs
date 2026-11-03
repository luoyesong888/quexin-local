import {parseArgs} from 'node:util'
import {dirname,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {configureInbox,WorkBuddyInbox,watchInbox} from '../server/lib/workbuddy-inbox.mjs'
import {inboxError} from '../shared/workbuddy-chat-files.mjs'

const projectRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const usage=`鹊信 WorkBuddy 文件夹交接（F2）
  configure --inbox <项目外的交换箱> --owner-id <账号ID> --space-id <空间ID> --yes
  status | scan | watch --owner-id <账号ID> --space-id <空间ID>
  approve --owner-id <账号ID> --space-id <空间ID> --batch-id <批次ID> --digest <scan给出的SHA> --yes
  retry --owner-id <账号ID> --space-id <空间ID> --batch-id <批次ID> --yes
可选：--data-root <本机服务状态目录>，configure --disabled 停用。
configure 仅授权发现清单；approve 才允许读取所选批次正文/图片。ready 仅表示校验通过，归档和青鸟入口将在后续阶段接入。`

async function main(){
 const action=process.argv[2]??'help'
 if(['help','--help','-h'].includes(action)){console.log(usage);return}
 const {values}=parseArgs({args:process.argv.slice(3),strict:true,options:{inbox:{type:'string'},'data-root':{type:'string'},'owner-id':{type:'string'},'space-id':{type:'string'},'batch-id':{type:'string'},digest:{type:'string'},yes:{type:'boolean'},disabled:{type:'boolean'}}})
 const options={dataRoot:resolve(values['data-root']??process.env.QUEXIN_LOCAL_DATA??resolve(projectRoot,'.local-data')),projectRoot,ownerId:values['owner-id'],spaceId:values['space-id']}
 if(['configure','approve','retry'].includes(action)&&!values.yes){console.log(JSON.stringify({ok:false,error:{code:'CONFIRM_REQUIRED',message:'检查参数后添加 --yes；当前没有写入或读取批次正文'}}));process.exitCode=2;return}
 if(action==='configure'){const config=await configureInbox({...options,inboxRoot:values.inbox,enabled:!values.disabled});console.log(JSON.stringify({ok:true,enabled:config.enabled,ownerId:config.ownerId,spaceId:config.spaceId}));return}
 const inbox=new WorkBuddyInbox(options)
 let result
 if(action==='status')result=await inbox.status()
 else if(action==='scan')result=await inbox.scan()
 else if(action==='approve')result={ok:true,...await inbox.approve(values['batch-id'],values.digest)}
 else if(action==='retry')result={ok:true,...await inbox.retry(values['batch-id'])}
 else if(action==='watch'){
  let previous='';const stop=watchInbox(inbox,{onResult:value=>{const summary=JSON.stringify({ok:value.ok,health:value.health.status,error:value.health.error,batches:value.batches.map(item=>({batchId:item.batchId,status:item.status,counts:item.counts,error:item.error}))});if(summary!==previous){previous=summary;console.log(summary)}}})
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{stop()})
  return
 }else throw new Error('invalid action')
 console.log(JSON.stringify(result,null,2));if(!result.ok)process.exitCode=1
}
main().catch(error=>{console.error(JSON.stringify({ok:false,error:inboxError(error)}));process.exitCode=1})
