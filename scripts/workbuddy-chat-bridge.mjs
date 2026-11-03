import {parseArgs} from 'node:util'
import {readFile} from 'node:fs/promises'
import {dirname,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {convertLegacyWorkBuddyExport,WORKBUDDY_CHAT_FORMAT} from '../shared/workbuddy-chat-contract.mjs'

const project=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const usage=`用法：
  node scripts/workbuddy-chat-bridge.mjs convert --source <WorkBuddy导出目录> --inbox <鹊信交换箱> --space-id <spaceId> --conversation-id <conversationId> [--media-overrides <补导原图目录>] [--dry-run]
  node scripts/workbuddy-chat-bridge.mjs task --source <WorkBuddy导出目录> --inbox <鹊信交换箱> --space-id <spaceId> --conversation-id <conversationId>

协议：${WORKBUDDY_CHAT_FORMAT}`
const action=process.argv[2]??'help',args=process.argv.slice(3)
const {values}=parseArgs({args,strict:true,options:{source:{type:'string'},'media-overrides':{type:'string'},inbox:{type:'string'},'space-id':{type:'string'},'conversation-id':{type:'string'},'job-id':{type:'string'},'batch-id':{type:'string'},'extractor-version':{type:'string'},timezone:{type:'string'},'dry-run':{type:'boolean',default:false}}})
const required=name=>{const value=String(values[name]??'').trim();if(!value)throw new Error(`缺少 --${name}`);return value}
const options=()=>({sourceDir:required('source'),mediaOverridesDir:values['media-overrides'],inboxRoot:required('inbox'),spaceId:required('space-id'),conversationId:required('conversation-id'),jobId:values['job-id'],batchId:values['batch-id'],extractorVersion:values['extractor-version'],timezone:values.timezone,dryRun:Boolean(values['dry-run'])})
const shellQuote=value=>"'"+value.replaceAll("'","'\\''")+"'"

async function main(){
 if(action==='help'||action==='--help'||action==='-h'){console.log(usage);return}
 if(action==='convert'){
  const result=await convertLegacyWorkBuddyExport(options())
  console.log(JSON.stringify({ok:true,...result.summary},null,2));return
 }
 if(action==='task'){
  const input=options(),template=await readFile(resolve(project,'skills/qingniao-agent/assets/workbuddy-chat-folder-task.md'),'utf8'),replacements={SOURCE_DIR:resolve(input.sourceDir),INBOX_ROOT:resolve(input.inboxRoot),SPACE_ID:input.spaceId,CONVERSATION_ID:input.conversationId,QUEXIN_PROJECT:project}
  const quoted=Object.fromEntries(Object.entries(replacements).map(([key,value])=>[key+'_SHELL',shellQuote(value)]))
  console.log(Object.entries({...replacements,...quoted}).reduce((text,[key,value])=>text.replaceAll(`{{${key}}}`,value),template));return
 }
 throw new Error(`不支持的动作：${action}\n${usage}`)
}

try{await main()}catch(error){console.error(`WorkBuddy 聊天交接：${error instanceof Error?error.message:String(error)}`);process.exitCode=1}
