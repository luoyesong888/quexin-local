import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createServer} from 'vite'

test('网页服务拒绝直接读取本地聊天数据库及状态文件',async()=>{
 const root=await mkdtemp('/private/tmp/quexin-archive-http-'),secret='PRIVATE_SYNTHETIC_ARCHIVE_CONTENT'
 let server
 try{
  await mkdir(join(root,'.local-data/workbuddy-archive'),{recursive:true})
  await mkdir(join(root,'workbuddy-inbox'))
  await writeFile(join(root,'index.html'),'<h1>public fixture</h1>')
  await writeFile(join(root,'.local-data/workbuddy-archive/chat.sqlite'),secret)
  await writeFile(join(root,'workbuddy-inbox/state.json'),secret)
  await writeFile(join(root,'private.sqlite-journal'),secret)
  server=await createServer({configFile:resolve('vite.config.ts'),root,logLevel:'silent',server:{port:0,host:'127.0.0.1',strictPort:false,proxy:{}}});await server.listen()
  const origin='http://127.0.0.1:'+server.httpServer.address().port
  assert.equal((await fetch(origin)).status,200)
  for(const path of ['/.local-data/workbuddy-archive/chat.sqlite','/workbuddy-inbox/state.json','/private.sqlite-journal','/@fs'+root+'/.local-data/workbuddy-archive/chat.sqlite']){
   const response=await fetch(origin+path);assert.equal(response.status,403);assert.equal((await response.text()).includes(secret),false)
  }
 }finally{await server?.close();await rm(root,{recursive:true,force:true})}
})
