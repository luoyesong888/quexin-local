import {collectPreflight} from './lib/workbuddy-preflight.mjs'

const json=process.argv.includes('--json'),result=await collectPreflight()
if(json)console.log(JSON.stringify(result,null,2))
else{
  console.log('鹊信 · WorkBuddy 本地部署预检（只读）')
  console.log(`目标：${result.target} · 系统 ${result.environment.osVersion||'未知'} · ${result.environment.architecture}`)
  for(const check of result.checks){console.log(`${check.status==='pass'?'✓':check.status==='warning'?'!':'×'} ${check.message}`);if(check.status!=='pass'&&check.remediation)console.log(`  建议：${check.remediation}`)}
  console.log(`结果：${result.ok?'可以进入安装阶段':'暂不能安装'} · ${result.summary.passed} 通过 / ${result.summary.warnings} 提醒 / ${result.summary.errors} 错误`)
  console.log('本命令没有安装依赖、初始化数据库、停止服务或修改任何资料。')
}
if(!result.ok)process.exitCode=1
