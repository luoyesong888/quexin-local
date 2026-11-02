import pg from 'pg'
import { runMaintenance } from './lib/maintenance-core.mjs'

const connectionString=process.env.MAINTENANCE_DATABASE_URL??process.env.DATABASE_URL
if(!connectionString)throw new Error('维护进程需要 MAINTENANCE_DATABASE_URL')
const {Pool}=pg,pool=new Pool({connectionString,max:2}),once=process.argv.includes('--once'),intervalMs=Math.max(10_000,Number(process.env.MAINTENANCE_INTERVAL_MS??60_000))
let running=false
async function run(){if(running)return;running=true;const startedAt=new Date();try{const result=await runMaintenance({pool});console.log('鹊信维护完成',JSON.stringify(result))}catch(error){const completedAt=new Date(),message=error instanceof Error?error.message:String(error);try{await pool.query(`INSERT INTO quexin.maintenance_runs(started_at,completed_at,status,details) VALUES($1,$2,'failed',$3)`,[startedAt,completedAt,{error:message}]);await pool.query(`INSERT INTO quexin.system_alerts(severity,source,code,message,details) VALUES('critical','maintenance','MAINTENANCE_FAILED','定时维护运行失败',$1)`,[{error:message}])}catch{}console.error('鹊信维护失败',error)}finally{running=false}}
await run()
if(once){await pool.end();process.exit(0)}
const timer=setInterval(()=>void run(),intervalMs)
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{clearInterval(timer);void pool.end().finally(()=>process.exit(0))})
