import test from 'node:test'
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
const exec=promisify(execFile)

test('Windows WSL 目标正确标注预览，归档完整可验证，macOS 目标保持独立',async()=>{
 const root=await mkdtemp(join(tmpdir(),'quexin-wsl-package-'))
 try{
  const result=JSON.parse((await exec(process.execPath,['scripts/release-bundle.mjs','--target','windows-wsl','--output',root])).stdout)
  assert.match(result.archive,/quexin-local-windows-wsl-v/)
  const manifest=JSON.parse(await readFile(result.manifest,'utf8'))
  assert.equal(manifest.target.platform,'linux');assert.equal(manifest.target.windowsNative,false);assert.equal(manifest.target.validation,'preview-not-tested-on-Windows')
  assert.ok(manifest.files.some(row=>row.path==='scripts/windows/Deploy-Quexin.ps1'));assert.ok(manifest.files.some(row=>row.path==='DEPLOY_WINDOWS_WSL.md'))
  const verified=JSON.parse((await exec(process.execPath,['scripts/release-verify.mjs',result.archive,'--json'])).stdout);assert.equal(verified.ok,true)
  const source=JSON.parse(await readFile('release/local-release-spec.json','utf8'));assert.equal(source.target.platform,'darwin')
  await assert.rejects(()=>exec(process.execPath,['scripts/release-bundle.mjs','--target','unknown','--output',root]))
 }finally{await rm(root,{recursive:true,force:true})}
})

test('Bash 入口语法通过，非 WSL 主机在运行安装前拒绝',async()=>{
 await exec('bash',['-n','scripts/windows/windows-entry.sh'])
 if(process.platform==='darwin')await assert.rejects(()=>exec('bash',['scripts/windows/windows-entry.sh','install','/does-not-exist']),error=>error.code===2&&/WSL2/.test(error.stderr))
 const ps=await readFile('scripts/windows/Deploy-Quexin.ps1','utf8')
 assert.match(ps,/--list --verbose/);assert.match(ps,/--exec bash/);assert.doesNotMatch(ps.replace(/^\s*#.*$/gm,''),/bash\s+-c\s|Invoke-Expression|Set-ExecutionPolicy|Remove-Item/)
})
