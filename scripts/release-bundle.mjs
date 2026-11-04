import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,mkdir,readFile,rename,rm,writeFile} from 'node:fs/promises'
import {basename,dirname,join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {tmpdir} from 'node:os'
import {collectReleaseFiles,copyPreservingMode,fileRecord,runtimeScripts,sha256File} from './lib/release-files.mjs'

const exec=promisify(execFile),project=resolve(dirname(fileURLToPath(import.meta.url)),'..'),args=process.argv.slice(2),after=(flag,fallback)=>{const index=args.indexOf(flag);return index>=0&&args[index+1]?args[index+1]:fallback},overwrite=args.includes('--overwrite'),packageJson=JSON.parse(await readFile(join(project,'package.json'),'utf8')),spec=JSON.parse(await readFile(join(project,'release/local-release-spec.json'),'utf8')),version=packageJson.version,target=after('--target','macos'),output=resolve(after('--output',join(project,'release/artifacts'))),archive=join(output,`quexin-local-${target}-v${version}.tar.gz`),checksum=archive+'.sha256',manifestSidecar=join(output,`quexin-local-${target}-v${version}.manifest.json`),temporary=await mkdtemp(join(tmpdir(),'quexin-release-')),root=join(temporary,'quexin-local'),temporaryArchive=join(temporary,basename(archive)),temporaryChecksum=temporaryArchive+'.sha256',temporaryManifest=join(temporary,basename(manifestSidecar))
try{
  if(!['macos','windows-wsl'].includes(target))throw new Error('发布目标只支持 macos 或 windows-wsl')
  const packageSpec=target==='windows-wsl'?{...spec,target:{...spec.target,platform:'linux',host:'Windows 10/11',runtime:'WSL2 Ubuntu',windowsNative:false,validation:'preview-not-tested-on-Windows'}}:spec
  await mkdir(output,{recursive:true})
  if(!overwrite)for(const path of [archive,checksum,manifestSidecar])try{await readFile(path);throw new Error(`发布文件已存在：${path}；确认覆盖时添加 --overwrite`)}catch(error){if(error.code!=='ENOENT')throw error}
  const files=await collectReleaseFiles(project,spec)
  for(const relative of files)await copyPreservingMode(join(project,relative),join(root,relative))
  if(target==='windows-wsl')await writeFile(join(root,'release/local-release-spec.json'),JSON.stringify(packageSpec,null,2)+'\n',{mode:0o644})
  const stagedPackage=JSON.parse(await readFile(join(root,'package.json'),'utf8'));stagedPackage.scripts=runtimeScripts(stagedPackage.scripts);await writeFile(join(root,'package.json'),JSON.stringify(stagedPackage,null,2)+'\n',{mode:0o644})
  const records=[];for(const relative of files)records.push(await fileRecord(root,relative))
  const policySha256=await sha256File(join(root,'release/local-release-spec.json')),manifest={format:'quexin-local-release-v1',product:'鹊信本地版',version,createdAt:new Date().toISOString(),packageRoot:'quexin-local',target:packageSpec.target,policySha256,fileCount:records.length,totalBytes:records.reduce((sum,item)=>sum+item.size,0),files:records}
  const manifestText=JSON.stringify(manifest,null,2)+'\n';await writeFile(join(root,'release-manifest.json'),manifestText,{mode:0o644});await writeFile(temporaryManifest,manifestText,{mode:0o644})
  await exec('tar',['-czf',temporaryArchive,'-C',temporary,'quexin-local'],{env:{...process.env,COPYFILE_DISABLE:'1'}})
  const archiveSha256=await sha256File(temporaryArchive);await writeFile(temporaryChecksum,`${archiveSha256}  ${basename(archive)}\n`,{mode:0o644})
  if(overwrite){await rm(archive,{force:true});await rm(checksum,{force:true});await rm(manifestSidecar,{force:true})}
  await rename(temporaryArchive,archive);await rename(temporaryChecksum,checksum);await rename(temporaryManifest,manifestSidecar)
  console.log(JSON.stringify({ok:true,archive,checksum,manifest:manifestSidecar,version,fileCount:manifest.fileCount,totalBytes:manifest.totalBytes,archiveSha256},null,2))
}finally{await rm(temporary,{recursive:true,force:true})}
