import fs from 'node:fs/promises'
import {join} from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
const exec=promisify(execFile),root=await fs.mkdtemp('/private/tmp/quexin fresh-'),project=process.cwd(),env={...process.env,WEB_PORT:'5388',LOCAL_API_PORT:'5393',LOCAL_MOCK_PORT:'5391',LOCAL_PG_PORT:'5547'}
const run=async(cmd,args)=>(await exec(cmd,args,{cwd:root,env,maxBuffer:5*1024*1024})).stdout
let c
try{
 for(const dir of ['src','shared','public','server','scripts'])await fs.cp(join(project,dir),join(root,dir),{recursive:true})
 for(const name of await fs.readdir(project))if(/^(package(?:-lock)?\.json|tsconfig.*\.json|vite\.config\.ts|index\.html)$/.test(name))await fs.copyFile(join(project,name),join(root,name))
 console.log('全新副本：安装锁定依赖');console.log(await run('npm',['ci',...(process.argv.includes('--offline')?['--offline']:[])]))
 console.log(await run('npm',['run','build']));console.log(await run(process.execPath,['scripts/local-runtime.mjs','init']))
 c=JSON.parse(await fs.readFile(join(root,'.local-data/runtime/config.json'),'utf8'))
 console.log(await run(process.execPath,['scripts/local-runtime.mjs','start']))
 const web=await fetch('http://127.0.0.1:5388/'),api=await fetch('http://127.0.0.1:5388/formal/health').then(r=>r.json())
 if(!web.ok||api.data.database!=='postgres')throw Error('新环境健康检查失败')
 console.log(await run(process.execPath,['scripts/local-runtime.mjs','stop']))
 await fs.mkdir(join(project,'reports/local-delivery-qa'),{recursive:true})
 await fs.writeFile(join(project,'reports/local-delivery-qa/fresh-install.json'),JSON.stringify({date:new Date().toISOString(),node:process.version,dependencyInstall:process.argv.includes('--offline')?'npm ci --offline':'npm ci',build:true,initialize:true,start:true,webStatus:web.status,database:api.data.database,stop:true,pathWithSpaces:true,scope:'当前电脑上的全新项目副本和新数据库；不是另一台电脑或另一种操作系统。'},null,2))
 console.log('全新副本安装、构建、初始化、启动和停止全部通过。')
}catch(error){console.error(error.stdout||error.stderr||error.message);process.exitCode=1}
finally{
 await run(process.execPath,['scripts/local-runtime.mjs','stop']).catch(()=>{})
 if(c?.pgData)await exec(join(c.pgBin,'pg_ctl'),['-D',c.pgData,'-m','fast','-w','stop']).catch(()=>{})
 await fs.rm(root,{recursive:true,force:true})
}
