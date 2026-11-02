import { mkdir,readFile,rename,rm,writeFile } from 'node:fs/promises'
import { dirname,resolve,sep } from 'node:path'
import { gzip } from 'node:zlib'
import { promisify } from 'node:util'

const gzipAsync=promisify(gzip)

export class LocalExportStore{
  constructor(root=process.env.EXPORT_ROOT??resolve('.local-data/exports')){this.root=resolve(root)}
  pathFor(key){const candidate=resolve(this.root,key);if(candidate!==this.root&&!candidate.startsWith(`${this.root}${sep}`))throw new Error('导出路径无效');return candidate}
  async write(jobId,payload){
    const key=`${jobId}.json.gz`,target=this.pathFor(key),temporary=`${target}.${crypto.randomUUID()}.tmp`,buffer=await gzipAsync(Buffer.from(JSON.stringify(payload),'utf8'),{level:9})
    await mkdir(dirname(target),{recursive:true});await writeFile(temporary,buffer,{flag:'wx',mode:0o600});await rename(temporary,target)
    return{key,buffer}
  }
  async read(key){return readFile(this.pathFor(key))}
  async remove(key){if(key)await rm(this.pathFor(key),{force:true})}
}
