import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {evaluatePreflight,collectPreflight} from '../scripts/lib/workbuddy-preflight.mjs'

const good={platform:'darwin',arch:'arm64',nodeVersion:'v22.12.0',npmVersion:'10.9.0',postgresVersion:'pg_ctl (PostgreSQL) 17.6',postgresToolsComplete:true,browser:'Safari',requiredFiles:[{name:'package.json',exists:true}],dependenciesInstalled:true,diskFreeBytes:10*1024**3,ports:[{port:4188,free:true},{port:4193,free:true}],runtimeRunning:false,dataExists:false,dataMode:null,dataSymlink:false}
const exec=promisify(execFile)
test('合格 macOS 环境通过且保持只读声明',()=>{const result=evaluatePreflight(good);assert.equal(result.ok,true);assert.equal(result.readOnly,true);assert.equal(result.summary.errors,0)})
test('缺少 Node/npm/PostgreSQL/浏览器会给出可执行建议',()=>{const result=evaluatePreflight({...good,nodeVersion:'v20.0.0',npmVersion:'',postgresVersion:'',postgresToolsComplete:false,browser:''});assert.equal(result.ok,false);assert.ok(result.summary.errors>=4);assert.ok(result.checks.filter(item=>item.status==='error').every(item=>item.remediation))})
test('非鹊信端口冲突和磁盘不足阻止安装',()=>{const result=evaluatePreflight({...good,diskFreeBytes:500*1024**2,ports:[{port:4188,free:false}]});assert.equal(result.ok,false);assert.equal(result.checks.find(item=>item.id==='port:4188').status,'error')})
test('已有资料和正在运行的鹊信只警告，不允许被误判为全新目录',()=>{const result=evaluatePreflight({...good,dataExists:true,dataMode:0o700,runtimeRunning:true,ports:[{port:4188,free:false}]});assert.equal(result.ok,true);assert.equal(result.checks.find(item=>item.id==='existing-data').status,'warning');assert.equal(result.checks.find(item=>item.id==='port:4188').status,'warning')})
test('真实采集不会修改已有资料',async()=>{const root=await mkdtemp('/private/tmp/quexin-preflight-'),sentinel=join(root,'do-not-touch.txt');try{await writeFile(sentinel,'保持原样');const result=await collectPreflight({projectRoot:process.cwd(),dataRoot:root,ports:[61481,61482,61483,61484]});assert.equal(await readFile(sentinel,'utf8'),'保持原样');assert.equal(result.readOnly,true);assert.equal(result.checks.find(item=>item.id==='existing-data').status,'warning')}finally{await rm(root,{recursive:true,force:true})}})
test('无 Node 的 bootstrap 只提示，不安装或初始化',async()=>{await assert.rejects(()=>exec('/bin/zsh',['WorkBuddy部署检查.command'],{cwd:process.cwd(),env:{...process.env,PATH:'/usr/bin:/bin'}}),error=>{assert.match(String(error.stdout),/未找到 Node.js/);assert.match(String(error.stdout),/没有安装软件/);return true})})
test('发布边界明确排除数据、密钥、依赖、日志和测试资料',async()=>{const spec=JSON.parse(await readFile('release/local-release-spec.json','utf8'));for(const path of ['.env.local','.local-data','node_modules','test-results','reports','tests'])assert.ok(spec.excludedPaths.includes(path));for(const name of ['database.dump','secrets.json','service.log'])assert.ok(spec.forbiddenNames.includes(name));assert.ok(spec.includeDirectories.includes('server'));assert.ok(spec.includeFiles.includes('package-lock.json'));assert.ok(spec.includeFiles.includes('DEPLOY_WITH_WORKBUDDY.md'))})
