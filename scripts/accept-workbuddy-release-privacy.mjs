// Local-only privacy evidence: report booleans/counts, never matched text or paths.
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {createHash} from 'node:crypto'
import {join,resolve} from 'node:path'
import {readChatFile} from '../shared/workbuddy-chat-files.mjs'
const exec=promisify(execFile),args=process.argv.slice(2),arg=name=>args[args.indexOf(name)+1]
if(!args.includes('--source-dir')||!args.includes('--archive')){console.error('需要 --source-dir 和 --archive，可另指定 --media-overrides');process.exit(2)}
const root=await mkdtemp('/private/tmp/quexin-release-audit-'),source=resolve(arg('--source-dir')),archive=resolve(arg('--archive')),hash=bytes=>createHash('sha256').update(bytes).digest('hex')
let summary
try{
 const sourceBytes=await readChatFile(source,'chat.json',64*1024*1024,{privateMode:false}),chat=JSON.parse(sourceBytes),hashes=new Set([hash(sourceBytes)])
 const texts=chat.chats.flatMap(day=>day.messages.map(message=>String(message.text??'')))
 const fragments=[...new Set(texts.filter(text=>text.length>=64).sort((a,b)=>b.length-a.length).slice(0,100).map(text=>text.slice(0,64)))]
 const images=new Set(texts.flatMap(text=>[...text.matchAll(/\[图片:([^\]]+)\]/g)].map(match=>match[1])))
 for(const path of images){hashes.add(hash(await readChatFile(source,path,25*1024*1024,{privateMode:false})));if(args.includes('--media-overrides'))try{hashes.add(hash(await readChatFile(resolve(arg('--media-overrides')),path,25*1024*1024,{privateMode:false})))}catch(error){if(error.code!=='MISSING_FILE')throw error}}
 const scan=async(base,files)=>{
  let matched=false,checked=0
  for(const file of files){const bytes=await readFile(join(base,file));checked++;if(hashes.has(hash(bytes)))matched=true;if(/\.(?:md|json|m?js|tsx?|css|html|txt|log|yaml|yml)$/.test(file)){const text=bytes.toString('utf8');if(fragments.some(fragment=>text.includes(fragment)))matched=true}}
  return{checked,matched}
 }
 const tracked=(await exec('git',['ls-files','-z'])).stdout.split('\0').filter(Boolean)
 const git=await scan(process.cwd(),tracked)
 await exec(process.execPath,['scripts/release-verify.mjs',archive]);await exec('tar',['-xzf',archive,'-C',root])
 const packageRoot=join(root,'quexin-local'),manifest=JSON.parse(await readFile(join(packageRoot,'release-manifest.json'),'utf8'))
 const release=await scan(packageRoot,manifest.files.map(file=>file.path))
 const logs=[]
 for(const file of ['test-results/full-final-console.log','test-results/final-package-console.log','.local-data/runtime/service.log']){try{await readFile(file);logs.push(file)}catch(error){if(error.code!=='ENOENT')throw error}}
 const ordinaryLogs=await scan(process.cwd(),logs)
 const forbiddenTracked=tracked.some(path=>/^(?:\.local-data\/|public\/zhuleyi\/|workbuddy-(?:inbox|archive|exchange)\/)|\.(?:sqlite3?|sqlite-(?:wal|shm|journal))$/.test(path))
 summary={ok:!git.matched&&!release.matched&&!ordinaryLogs.matched&&!forbiddenTracked,date:new Date().toISOString(),git,release,ordinaryLogs,forbiddenTracked,sampledLongFragments:fragments.length,rawFileHashes:hashes.size,archiveSha256:hash(await readFile(archive))}
 if(!summary.ok)process.exitCode=1
}catch{summary={ok:false,error:'PRIVACY_AUDIT_FAILED'};process.exitCode=1}
finally{await rm(root,{recursive:true,force:true});await mkdir('test-results/workbuddy-final',{recursive:true});await writeFile('test-results/workbuddy-final/release-privacy-summary.json',JSON.stringify(summary,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(summary,null,2))}
