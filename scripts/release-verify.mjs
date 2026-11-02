import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {lstat,mkdtemp,readFile,rm} from 'node:fs/promises'
import {basename,dirname,join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {fileRecord,forbiddenPath,normalizePath,sha256File,walkFiles} from './lib/release-files.mjs'

const exec=promisify(execFile),project=resolve(dirname(fileURLToPath(import.meta.url)),'..'),target=process.argv[2]?resolve(process.argv[2]):'',json=process.argv.includes('--json')
const equal=(left,right)=>JSON.stringify(left)===JSON.stringify(right)
function safeArchiveEntry(name){const value=String(name).replace(/\/$/,'');return Boolean(value)&&!value.startsWith('/')&&!value.split('/').includes('..')&&(value==='quexin-local'||value.startsWith('quexin-local/'))}
async function verifyDirectory(root,archiveSha256=null){
  const manifestPath=join(root,'release-manifest.json'),manifest=JSON.parse(await readFile(manifestPath,'utf8'));if(manifest.format!=='quexin-local-release-v1'||manifest.packageRoot!=='quexin-local')throw new Error('发布清单格式无效')
  const spec=JSON.parse(await readFile(join(root,'release/local-release-spec.json'),'utf8'));if(await sha256File(join(root,'release/local-release-spec.json'))!==manifest.policySha256)throw new Error('发布边界规范摘要不匹配')
  const actual=await walkFiles(root),withoutManifest=actual.filter(path=>path!=='release-manifest.json')
  for(const path of actual)if(forbiddenPath(path,spec))throw new Error(`发布包包含禁止路径：${path}`)
  for(const required of spec.includeFiles??[])if(!withoutManifest.includes(normalizePath(required)))throw new Error(`发布包缺少必需文件：${required}`)
  const expectedPaths=manifest.files.map(item=>item.path).sort();if(!equal(withoutManifest,expectedPaths))throw new Error('发布包文件数量或路径与清单不一致')
  for(const expected of manifest.files){const actualRecord=await fileRecord(root,expected.path);if(!equal(actualRecord,expected))throw new Error(`发布文件摘要、大小或权限不匹配：${expected.path}`)}
  if(manifest.fileCount!==manifest.files.length||manifest.totalBytes!==manifest.files.reduce((sum,item)=>sum+item.size,0))throw new Error('发布清单统计不一致')
  const packageJson=JSON.parse(await readFile(join(root,'package.json'),'utf8'));if(packageJson.version!==manifest.version)throw new Error('package.json 与发布版本不一致')
  return{ok:true,version:manifest.version,fileCount:manifest.fileCount,totalBytes:manifest.totalBytes,...(archiveSha256?{archiveSha256}:{})}
}
async function main(){
  if(!target)throw new Error('用法：node scripts/release-verify.mjs <发布包.tar.gz|解压目录> [--json]')
  const info=await lstat(target)
  if(info.isSymbolicLink())throw new Error('不验证符号链接目标')
  if(info.isDirectory()){const root=await import('node:fs/promises').then(fs=>fs.access(join(target,'release-manifest.json')).then(()=>target).catch(()=>basename(target)==='quexin-local'?target:join(target,'quexin-local'))),result=await verifyDirectory(root);return result}
  if(!target.endsWith('.tar.gz'))throw new Error('只接受 .tar.gz 发布包或解压目录')
  const checksumPath=target+'.sha256',manifestSidecar=target.replace(/\.tar\.gz$/,'.manifest.json'),line=(await readFile(checksumPath,'utf8')).trim(),[expected,name]=line.split(/\s+/);if(name!==basename(target)||!/^[a-f0-9]{64}$/.test(expected))throw new Error('SHA-256 文件格式无效')
  const actualSha256=await sha256File(target);if(actualSha256!==expected)throw new Error('发布包 SHA-256 不匹配，文件可能损坏或被篡改')
  const listing=(await exec('tar',['-tzf',target])).stdout.trim().split('\n').filter(Boolean);if(!listing.length||listing.some(name=>!safeArchiveEntry(name)))throw new Error('归档包含不安全路径')
  const verbose=(await exec('tar',['-tvzf',target])).stdout.trim().split('\n').filter(Boolean);if(verbose.some(line=>['l','h'].includes(line.trim()[0])))throw new Error('归档包含链接，不允许解压')
  const temporary=await mkdtemp('/private/tmp/quexin-verify-')
  try{await exec('tar',['-xzf',target,'-C',temporary],{env:{...process.env,COPYFILE_DISABLE:'1'}});const packageRoot=join(temporary,'quexin-local'),external=JSON.parse(await readFile(manifestSidecar,'utf8')),internal=JSON.parse(await readFile(join(packageRoot,'release-manifest.json'),'utf8'));if(!equal(external,internal))throw new Error('包外 manifest 与包内 manifest 不一致');return await verifyDirectory(packageRoot,actualSha256)}finally{await rm(temporary,{recursive:true,force:true})}
}
try{const result=await main();if(json)console.log(JSON.stringify(result,null,2));else console.log(`✓ 发布包校验通过 · v${result.version} · ${result.fileCount} 个文件 · ${result.totalBytes} 字节`)}catch(error){console.error(`发布包校验失败：${error instanceof Error?error.message:String(error)}`);process.exitCode=1}
