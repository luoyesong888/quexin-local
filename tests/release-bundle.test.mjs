import test from 'node:test'
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {appendFile,mkdtemp,mkdir,readFile,rm,unlink,writeFile} from 'node:fs/promises'
import {join} from 'node:path'

const exec=promisify(execFile),node=process.execPath,bundle='scripts/release-bundle.mjs',verify='scripts/release-verify.mjs'

test('发布包按白名单生成、可校验，并拒绝覆盖、禁止文件和任何篡改',async()=>{
  const root=await mkdtemp('/private/tmp/quexin release bundle-'),output=join(root,'artifacts'),extract=join(root,'extracted')
  try{
    const built=JSON.parse((await exec(node,[bundle,'--output',output],{cwd:process.cwd(),maxBuffer:8*1024*1024})).stdout),archive=built.archive,checksum=built.checksum
    assert.match(built.archiveSha256,/^[a-f0-9]{64}$/);assert.ok(built.fileCount>20);assert.ok(built.totalBytes>1000)
    const verified=JSON.parse((await exec(node,[verify,archive,'--json'],{cwd:process.cwd(),maxBuffer:8*1024*1024})).stdout);assert.equal(verified.ok,true);assert.equal(verified.archiveSha256,built.archiveSha256)
    await assert.rejects(()=>exec(node,[bundle,'--output',output],{cwd:process.cwd()}),error=>{assert.match(error.stderr,/发布文件已存在/);return true})
    const externalManifestText=await readFile(built.manifest,'utf8'),externalManifest=JSON.parse(externalManifestText);assert.equal(externalManifest.fileCount,built.fileCount);await writeFile(built.manifest,JSON.stringify({...externalManifest,version:'tampered'}));await assert.rejects(()=>exec(node,[verify,archive],{cwd:process.cwd()}),error=>{assert.match(error.stderr,/manifest 不一致/);return true});await writeFile(built.manifest,externalManifestText)
    const listing=(await exec('tar',['-tzf',archive])).stdout;for(const forbidden of ['.local-data','.env.local','node_modules','test-results','reports/','tests/','scripts/test-','scripts/dev-'])assert.equal(listing.includes(forbidden),false)
    await mkdir(extract);await exec('tar',['-xzf',archive,'-C',extract]);const packageRoot=join(extract,'quexin-local'),manifest=JSON.parse(await readFile(join(packageRoot,'release-manifest.json'),'utf8')),packaged=JSON.parse(await readFile(join(packageRoot,'package.json'),'utf8'))
    assert.equal(manifest.fileCount,manifest.files.length);assert.equal(manifest.version,packaged.version);assert.equal(Object.keys(packaged.scripts).some(name=>name.startsWith('test:')||name.startsWith('dev:')),false);assert.equal(packaged.scripts['workbuddy:chat'],'node scripts/workbuddy-chat-bridge.mjs');assert.match(await readFile(join(packageRoot,'shared/workbuddy-chat-contract.schema.json'),'utf8'),/quexin-workbuddy-chat-v1/);assert.match(await readFile(join(packageRoot,'skills/qingniao-agent/assets/workbuddy-chat-folder-task.md'),'utf8'),/workbuddy-chat-bridge\.mjs convert/)
    assert.equal(JSON.parse((await exec(node,[verify,packageRoot,'--json'],{cwd:process.cwd()})).stdout).ok,true)
    await writeFile(join(packageRoot,'.env.local'),'SECRET_SHOULD_NEVER_SHIP=1\n');await assert.rejects(()=>exec(node,[verify,packageRoot],{cwd:process.cwd()}),error=>{assert.match(error.stderr,/禁止路径/);return true});await unlink(join(packageRoot,'.env.local'))
    await appendFile(join(packageRoot,'README.md'),'\n篡改');await assert.rejects(()=>exec(node,[verify,packageRoot],{cwd:process.cwd()}),error=>{assert.match(error.stderr,/摘要、大小或权限不匹配/);return true})
    await appendFile(archive,'tampered');await assert.rejects(()=>exec(node,[verify,archive],{cwd:process.cwd()}),error=>{assert.match(error.stderr,/SHA-256 不匹配/);return true});assert.match(await readFile(checksum,'utf8'),/^[a-f0-9]{64}\s+quexin-local-macos-v/)
  }finally{await rm(root,{recursive:true,force:true})}
})
