import {createHash} from 'node:crypto'
import {access,chmod,copyFile,lstat,mkdir,readFile,readdir} from 'node:fs/promises'
import {basename,dirname,join} from 'node:path'

export const exists=path=>access(path).then(()=>true).catch(()=>false)
export const normalizePath=path=>String(path).replaceAll('\\','/').replace(/^\.\//,'').replace(/\/$/,'')
export function forbiddenPath(path,spec){
  const value=normalizePath(path),name=basename(value)
  if(!value||value.startsWith('/')||value.split('/').includes('..'))return true
  if((spec.forbiddenNames??[]).includes(name))return true
  if((spec.excludedPrefixes??[]).some(prefix=>value.startsWith(normalizePath(prefix))))return true
  return(spec.excludedPaths??[]).some(excluded=>value===normalizePath(excluded)||value.startsWith(normalizePath(excluded)+'/'))
}
export async function walkFiles(root,prefix=''){
  const output=[]
  for(const entry of await readdir(join(root,prefix),{withFileTypes:true})){
    const relative=normalizePath(join(prefix,entry.name)),path=join(root,relative),info=await lstat(path)
    if(info.isSymbolicLink())throw new Error(`不接受符号链接：${relative}`)
    if(info.isDirectory())output.push(...await walkFiles(root,relative))
    else if(info.isFile())output.push(relative)
    else throw new Error(`不接受特殊文件：${relative}`)
  }
  return output.sort()
}
export async function collectReleaseFiles(project,spec){
  const files=new Set()
  for(const relative of spec.includeFiles??[]){const value=normalizePath(relative),path=join(project,value);if(!await exists(path))throw new Error(`发布必需文件不存在：${value}`);const info=await lstat(path);if(info.isSymbolicLink()||!info.isFile())throw new Error(`发布必需路径不是普通文件：${value}`);if(forbiddenPath(value,spec))throw new Error(`发布必需文件同时被禁止：${value}`);files.add(value)}
  for(const directory of spec.includeDirectories??[]){const value=normalizePath(directory),path=join(project,value);if(!await exists(path))throw new Error(`发布必需目录不存在：${value}`);for(const relative of await walkFiles(project,value))if(!forbiddenPath(relative,spec))files.add(relative)}
  return[...files].sort()
}
export async function copyPreservingMode(source,target){const info=await lstat(source);if(info.isSymbolicLink()||!info.isFile())throw new Error(`不接受非普通文件：${source}`);await mkdir(dirname(target),{recursive:true,mode:0o755});await copyFile(source,target);await chmod(target,info.mode&0o777)}
export async function sha256File(path){const hash=createHash('sha256');hash.update(await readFile(path));return hash.digest('hex')}
export async function fileRecord(root,relative){const path=join(root,relative),info=await lstat(path);return{path:normalizePath(relative),size:info.size,mode:(info.mode&0o777).toString(8).padStart(3,'0'),sha256:await sha256File(path)}}
export function runtimeScripts(scripts={}){const allowed=new Set(['local:init','local:start','local:stop','local:status','local:migrate','local:backup','local:cleanup','local:restore','local:doctor','production:doctor','workbuddy:check','workbuddy:deploy','workbuddy:config','workbuddy:lifecycle','workbuddy:chat','release:bundle','release:verify','build','start:api','db:migrate','maintenance:once','maintenance:local','notification:once','notification:local']);return Object.fromEntries(Object.entries(scripts).filter(([name])=>allowed.has(name)))}
