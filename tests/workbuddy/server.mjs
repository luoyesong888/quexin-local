import {mkdtemp,rm} from 'node:fs/promises'
import {spawn} from 'node:child_process'
const root=await mkdtemp('/private/tmp/quexin-wb-test-server-')
const child=spawn(process.execPath,['server/prod-server.mjs','--memory','--port','6193'],{stdio:'inherit',env:{...process.env,QUEXIN_LOCAL_DATA:root}})
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal))
child.once('exit',async code=>{await rm(root,{recursive:true,force:true});process.exit(code??0)})
