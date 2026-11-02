import { createServer } from 'node:http'
import { createHash, randomUUID } from 'node:crypto'
import { MemoryStore, StoreError } from './lib/memory-store.mjs'
import { DevMailer } from './lib/dev-mailer.mjs'
import { LocalMediaStore, MediaProcessingError } from './lib/local-media-store.mjs'
import { LocalExportStore } from './lib/local-export-store.mjs'
import { encryptNotification } from './lib/notification-crypto.mjs'
import {AssistantProvider,AssistantProviderError} from './lib/assistant-provider.mjs'
import {readAssistantAdminConfig,requestLocalRestart,saveAssistantAdminConfig} from './lib/optional-config.mjs'
import {encryptCapsule,decryptCapsule} from './lib/capsule-crypto.mjs'
import {
  clearSessionCookie, hashPassword, hashToken, newSessionToken, normalizeEmail,
  parseCookies, sessionCookie, validEmail, validPassword, verifyPassword,
} from './lib/security.mjs'

const args = process.argv.slice(2)
const valueAfter = (flag, fallback) => { const index = args.indexOf(flag); return index >= 0 && args[index + 1] ? args[index + 1] : fallback }
const port = Number(valueAfter('--port', process.env.PORT ?? '4193'))
const host = valueAfter('--host', process.env.HOST ?? '127.0.0.1')
const memory = args.includes('--memory')
const publicOrigin = process.env.PUBLIC_ORIGIN ?? `http://${host}:${port}`
const secureCookie = publicOrigin.startsWith('https://')
const devMailbox = process.env.DEV_MAILBOX === 'true'
const notificationKey=process.env.NOTIFICATION_ENCRYPTION_KEY??''
const capsuleKey=process.env.CAPSULE_ENCRYPTION_KEY??''
const mailer = new DevMailer(devMailbox)
const mediaStore = new LocalMediaStore()
const exportStore = new LocalExportStore()
const assistantProvider=new AssistantProvider()
const store = memory ? new MemoryStore() : await (async () => {
  if (!process.env.DATABASE_URL) throw new Error('正式服务需要 DATABASE_URL；本地契约测试请使用 --memory')
  const { PostgresStore } = await import('./lib/postgres-store.mjs')
  return new PostgresStore(process.env.DATABASE_URL)
})()

const attempts = new Map()
function rateLimit(key, limit = 12, windowMs = 15 * 60_000) {
  const now = Date.now(), current = attempts.get(key)
  if (!current || current.resetAt <= now) { attempts.set(key, { count: 1, resetAt: now + windowMs }); return null }
  current.count += 1
  return current.count > limit ? Math.ceil((current.resetAt - now) / 1000) : null
}
function clientIp(request) { return request.socket.remoteAddress ?? 'unknown' }

const send = (response, status, payload, headers = {}) => {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', ...headers })
  response.end(JSON.stringify(payload))
}
const ok = (response, data, requestId, status = 200, headers) => send(response, status, { ok: true, data, requestId }, headers)
const fail = (response, status, code, message, requestId, extra = {}) => send(response, status, { ok: false, error: { code, message, requestId, ...extra } })
const sendBinary = (response, buffer, contentType = 'application/octet-stream') => {
  response.writeHead(200, {
    'content-type': contentType, 'content-length': buffer.length, 'cache-control': 'private, no-store',
    'content-security-policy': "default-src 'none'; sandbox", 'cross-origin-resource-policy': 'same-origin',
    'x-content-type-options': 'nosniff', 'content-disposition': 'inline',
  })
  response.end(buffer)
}
const sendDownload=(response,buffer,filename)=>{
  response.writeHead(200,{'content-type':'application/gzip','content-length':buffer.length,'cache-control':'private, no-store','content-disposition':`attachment; filename="${filename}"`,'x-content-type-options':'nosniff','cross-origin-resource-policy':'same-origin'})
  response.end(buffer)
}
const sse=(response,event,data)=>response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

async function bodyOf(request) {
  const chunks = []; let size = 0
  for await (const chunk of request) { size += chunk.length; if (size > 2 * 1024 * 1024) throw new StoreError('VALIDATION_FAILED', '请求内容超过 2MB', 413); chunks.push(chunk) }
  if (!chunks.length) return {}
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw new StoreError('VALIDATION_FAILED', 'JSON 格式无效', 400) }
}
async function bodyBufferOf(request, maximum,limitMessage='文件超过大小上限') {
  const chunks = []; let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > maximum) throw new StoreError('VALIDATION_FAILED', limitMessage, 413)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}
function requestSessionToken(request) { return parseCookies(request.headers.cookie ?? '').qx_session ?? '' }
async function currentUser(request) {
  const token = requestSessionToken(request)
  if (!token) return null
  const found = await store.sessionByHash(hashToken(token))
  return found ? { ...found.user, tokenHash: hashToken(token), session: found.session } : null
}
async function requireUser(request, response, requestId) {
  const user = await currentUser(request)
  if (!user) fail(response, 401, 'UNAUTHENTICATED', '请先登录', requestId)
  return user
}
function checkOrigin(request, response, requestId) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method ?? 'GET')) return true
  const origin = request.headers.origin
  if (origin && origin !== publicOrigin) { fail(response, 403, 'FORBIDDEN', '请求来源不被允许', requestId); return false }
  return true
}
function sessionView(user, session) { return { userId: user.id, displayName: user.displayName, email: user.email, emailVerified: Boolean(user.emailVerifiedAt), sessionId: session.id, expiresAt: session.expiresAt } }

async function issueSession(request, response, user, requestId, status = 200) {
  const token = newSessionToken(), expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString()
  const session = await store.createSession({ userId: user.id, tokenHash: hashToken(token), expiresAt, userAgent: String(request.headers['user-agent'] ?? '').slice(0, 300), ipHash: hashToken(clientIp(request)) })
  ok(response, sessionView(user, session), requestId, status, { 'set-cookie': sessionCookie(token, { secure: secureCookie }) })
}

async function sendAccountToken(user, purpose, ttlMinutes) {
  const token = newSessionToken(), expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString()
  await store.createAccountToken({ userId: user.id, purpose, tokenHash: hashToken(token), expiresAt })
  await mailer.send({ email: user.email, purpose, token, expiresAt })
  if(notificationKey)await store.enqueueNotification({recipient:user.email,kind:purpose,...encryptNotification({token,expiresAt},notificationKey)})
  else if(!devMailbox)throw new Error('正式环境需要 NOTIFICATION_ENCRYPTION_KEY')
}

async function route(request, response) {
  const requestId = randomUUID(), url = new URL(request.url ?? '/', publicOrigin), path = url.pathname
  if (!checkOrigin(request, response, requestId)) return
  if (request.method === 'GET' && path === '/health') {try{await store.health();const model=assistantProvider.publicConfig();return ok(response,{status:'ready',database:memory?'memory-test':'postgres',capabilities:{assistant:model.enabled,ocr:model.ocrEnabled,transcription:model.transcriptionEnabled}},requestId)}catch{return fail(response,503,'NOT_READY','数据库尚未就绪',requestId)}}
  if (request.method === 'GET' && path === '/v1/auth/config') return ok(response, { developmentMailbox: devMailbox }, requestId)
  if (request.method === 'GET' && path === '/v1/dev/mailbox/latest' && devMailbox) {
    if (!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(clientIp(request))) return fail(response,403,'FORBIDDEN','开发邮件箱只允许本机访问',requestId)
    const message=mailer.latest(normalizeEmail(url.searchParams.get('email')),String(url.searchParams.get('purpose')??''))
    return message?ok(response,message,requestId):fail(response,404,'NOT_FOUND','没有找到开发邮件',requestId)
  }

  if (request.method === 'POST' && path === '/v1/auth/register') {
    const retryAfterSeconds = rateLimit(`register:${clientIp(request)}`, 40)
    if (retryAfterSeconds) return fail(response, 429, 'RATE_LIMITED', '请求过于频繁，请稍后再试', requestId, { retryAfterSeconds })
    const body = await bodyOf(request), email = normalizeEmail(body.email), displayName = String(body.displayName ?? '').trim().slice(0, 30), password = body.password
    const fieldErrors = {}
    if (!validEmail(email)) fieldErrors.email = '请输入有效邮箱'
    if (!validPassword(password)) fieldErrors.password = '密码需要 10—128 个字符'
    if (!displayName) fieldErrors.displayName = '请输入称呼'
    if (Object.keys(fieldErrors).length) return fail(response, 400, 'VALIDATION_FAILED', '请检查注册信息', requestId, { fieldErrors })
    const user = await store.createUser({ email, displayName, passwordHash: await hashPassword(password) })
    await sendAccountToken(user,'verify_email',30)
    return issueSession(request,response,user,requestId,201)
  }
  if (request.method === 'POST' && path === '/v1/auth/login') {
    const retryAfterSeconds = rateLimit(`login:${clientIp(request)}`)
    if (retryAfterSeconds) return fail(response, 429, 'RATE_LIMITED', '登录尝试过多，请稍后再试', requestId, { retryAfterSeconds })
    const body = await bodyOf(request), email = normalizeEmail(body.email), password = String(body.password ?? '')
    const user = await store.userByEmail(email)
    if (!user || !await verifyPassword(password, user.passwordHash)) return fail(response, 401, 'INVALID_CREDENTIALS', '邮箱或密码不正确', requestId)
    return issueSession(request,response,user,requestId)
  }
  if (request.method === 'POST' && path === '/v1/auth/logout') {
    const token = requestSessionToken(request)
    if (token) await store.deleteSession(hashToken(token))
    return ok(response, { loggedOut: true }, requestId, 200, { 'set-cookie': clearSessionCookie({ secure: secureCookie }) })
  }
  if (request.method === 'POST' && path === '/v1/auth/email/verify') {
    const retryAfterSeconds=rateLimit(`verify:${clientIp(request)}`,30)
    if(retryAfterSeconds)return fail(response,429,'RATE_LIMITED','验证次数过多，请稍后重试',requestId,{retryAfterSeconds})
    const body=await bodyOf(request),user=await store.verifyEmailToken(hashToken(String(body.token??'')))
    if(!user)return fail(response,400,'INVALID_TOKEN','验证链接无效或已经过期',requestId)
    return ok(response,{verified:true},requestId)
  }
  if(request.method==='POST'&&path==='/v1/auth/email/resend'){
    const retryAfterSeconds=rateLimit(`resend:${clientIp(request)}`,10)
    if(retryAfterSeconds)return fail(response,429,'RATE_LIMITED','请求过于频繁，请稍后再试',requestId,{retryAfterSeconds})
    const body=await bodyOf(request),email=normalizeEmail(body.email)
    if(!validEmail(email))return fail(response,400,'VALIDATION_FAILED','请输入有效邮箱',requestId)
    const user=await store.userByEmail(email)
    if(user&&!user.emailVerifiedAt)await sendAccountToken(user,'verify_email',30)
    return ok(response,{sent:true},requestId)
  }
  if (request.method === 'POST' && path === '/v1/auth/password/forgot') {
    const retryAfterSeconds=rateLimit(`forgot:${clientIp(request)}`,6,15*60_000)
    if(retryAfterSeconds)return fail(response,429,'RATE_LIMITED','请求过于频繁，请稍后再试',requestId,{retryAfterSeconds})
    const body=await bodyOf(request),user=await store.userByEmail(normalizeEmail(body.email))
    if(user)await sendAccountToken(user,'reset_password',20)
    return ok(response,{sent:true},requestId)
  }
  if (request.method === 'POST' && path === '/v1/auth/password/reset') {
    const retryAfterSeconds=rateLimit(`reset:${clientIp(request)}`,20)
    if(retryAfterSeconds)return fail(response,429,'RATE_LIMITED','重置次数过多，请稍后重试',requestId,{retryAfterSeconds})
    const body=await bodyOf(request)
    if(!validPassword(body.password))return fail(response,400,'VALIDATION_FAILED','新密码需要 10—128 个字符',requestId,{fieldErrors:{password:'密码需要 10—128 个字符'}})
    const user=await store.resetPasswordWithToken(hashToken(String(body.token??'')),await hashPassword(body.password))
    if(!user)return fail(response,400,'INVALID_TOKEN','重置链接无效或已经过期',requestId)
    return ok(response,{reset:true},requestId,200,{'set-cookie':clearSessionCookie({secure:secureCookie})})
  }

  const user = await requireUser(request, response, requestId)
  if (!user) return
  if (request.method === 'GET' && path === '/v1/session') return ok(response, sessionView(user,user.session), requestId)
  if(request.method==='GET'&&path==='/v1/assistant/config')return ok(response,assistantProvider.publicConfig(),requestId)
  if(request.method==='GET'&&path==='/v1/admin/assistant-config')return ok(response,await readAssistantAdminConfig(),requestId)
  if(request.method==='PUT'&&path==='/v1/admin/assistant-config'){
    if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(clientIp(request)))return fail(response,403,'FORBIDDEN','模型配置只允许在运行鹊信的本机修改',requestId)
    const retry=rateLimit(`assistant-config:${user.id}`,8,15*60_000)
    if(retry)return fail(response,429,'RATE_LIMITED','模型配置修改过于频繁，请稍后再试',requestId,{retryAfterSeconds:retry})
    const body=await bodyOf(request)
    if(!await verifyPassword(String(body.currentPassword??''),user.passwordHash))return fail(response,401,'INVALID_CREDENTIALS','当前密码不正确',requestId)
    let saved
    try{saved=await saveAssistantAdminConfig({enabled:body.enabled,provider:body.provider,apiUrl:body.apiUrl,apiKey:body.apiKey,model:body.model,transcriptionModel:body.transcriptionModel})}
    catch(error){return fail(response,400,'VALIDATION_FAILED',String(error?.message??'模型配置无效'),requestId)}
    const restarting=Boolean(process.env.LOCAL_CONTROL_SOCKET&&process.env.LOCAL_CONTROL_TOKEN)
    ok(response,{...saved,restarting},requestId)
    if(restarting)setTimeout(()=>void requestLocalRestart().catch(error=>console.error(`模型配置已保存，但自动重启失败：${error.message}`)),250)
    return
  }
  if(request.method==='POST'&&(path==='/v1/import/ocr'||path==='/v1/import/transcribe')){
    if(request.headers['x-quexin-consent']!=='true')return fail(response,400,'CONSENT_REQUIRED','请先确认将这个文件发送到配置的识别服务',requestId)
    const kind=path.endsWith('/ocr')?'ocr':'transcribe',retry=rateLimit(`recognition:${kind}:${user.id}`,20,15*60_000)
    if(retry)return fail(response,429,'RATE_LIMITED','识别请求过于频繁，请稍后再试',requestId,{retryAfterSeconds:retry})
    const type=String(request.headers['content-type']??'').split(';')[0].trim().toLowerCase(),name=decodeURIComponent(String(request.headers['x-file-name']??(kind==='ocr'?'image':'audio'))).slice(0,180)
    const input=await bodyBufferOf(request,kind==='ocr'?10*1024*1024:25*1024*1024,kind==='ocr'?'图片超过 10MB 上限':'录音超过 25MB 上限')
    const controller=new AbortController();request.once('aborted',()=>controller.abort());response.once('close',()=>{if(!response.writableEnded)controller.abort()})
    try{const result=kind==='ocr'?await assistantProvider.ocr({buffer:input,contentType:type,filename:name},{signal:controller.signal}):await assistantProvider.transcribe({buffer:input,contentType:type,filename:name},{signal:controller.signal});return ok(response,{...result,method:kind==='ocr'?'vision-ocr':'audio-transcription'},requestId)}
    catch(error){if(response.destroyed||controller.signal.aborted)return;if(error instanceof AssistantProviderError)return fail(response,error.status,error.code,error.message,requestId);throw error}
  }
  if(request.method==='POST'&&['/v1/assistant/chat','/v1/assistant/answer','/v1/assistant/candidates','/v1/assistant/creative','/v1/assistant/agent'].includes(path)){
    const retry=rateLimit(`assistant:${user.id}`,40,15*60_000)
    if(retry)return fail(response,429,'RATE_LIMITED','模型请求过于频繁，请稍后再试',requestId,{retryAfterSeconds:retry})
    const incoming=await bodyOf(request),chat=path.endsWith('/chat'),kind=chat?(incoming.operation==='conversation'?'conversation':incoming.operation==='question'?'answer':incoming.operation==='agent'?'agent':'invalid'):path.endsWith('/answer')?'answer':path.endsWith('/creative')?'creative':path.endsWith('/agent')?'agent':'candidates',body=chat?incoming.payload:incoming,controller=new AbortController()
    if(kind==='invalid')return fail(response,400,'VALIDATION_FAILED','统一聊天操作只允许 conversation、question 或 agent',requestId)
    request.once('aborted',()=>controller.abort());response.once('close',()=>{if(!response.writableEnded)controller.abort()})
    response.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-store','x-accel-buffering':'no','x-content-type-options':'nosniff'})
    sse(response,'status',{stage:'started',requestId,model:assistantProvider.publicConfig().model})
    try{const result=await assistantProvider.run(kind,body,{signal:controller.signal,onProgress:event=>sse(response,'progress',event)});sse(response,'result',result)}
    catch(error){const known=error instanceof AssistantProviderError?error:new AssistantProviderError('MODEL_FAILED','模型处理失败');sse(response,'error',{code:known.code,message:known.message,requestId})}
    response.end();return
  }
  if(request.method==='DELETE'&&path==='/v1/account'){
    const body=await bodyOf(request)
    const retry=rateLimit(`account-close:${user.id}`,5)
    if(retry)return fail(response,429,'RATE_LIMITED','请稍后再试',requestId)
    if(body.confirmation!=='注销我的账号')return fail(response,400,'CONFIRMATION_MISMATCH','请输入“注销我的账号”',requestId)
    if(!await verifyPassword(String(body.password??''),user.passwordHash))return fail(response,401,'INVALID_CREDENTIALS','密码不正确',requestId)
    const removed=await store.endMembership(user.id,true)
    const cleanup=await Promise.allSettled([...removed.media.map(m=>mediaStore.remove(m)),...removed.exports.filter(j=>j.objectKey).map(j=>exportStore.remove(j.objectKey))])
    return ok(response,{accountDeleted:true,spaceId:removed.spaceId,remainingMember:removed.remainingMember,cleanupPending:cleanup.some(r=>r.status==='rejected')},requestId,200,{'set-cookie':clearSessionCookie({secure:secureCookie})})
  }
  if (request.method === 'POST' && path === '/v1/auth/email/verify/request') {
    const retryAfterSeconds=rateLimit(`resend-user:${user.id}`,10)
    if(retryAfterSeconds)return fail(response,429,'RATE_LIMITED','请求过于频繁，请稍后再试',requestId,{retryAfterSeconds})
    if(!user.emailVerifiedAt)await sendAccountToken(user,'verify_email',30)
    return ok(response,{sent:true},requestId)
  }
  if (request.method === 'GET' && path === '/v1/auth/sessions') {
    const sessions=await store.listSessions(user.id)
    return ok(response,sessions.map(item=>({id:item.id,userAgent:item.userAgent,createdAt:item.createdAt,lastSeenAt:item.lastSeenAt,expiresAt:item.expiresAt,current:item.id===user.session.id})),requestId)
  }
  const revokeSession=path.match(/^\/v1\/auth\/sessions\/([^/]+)$/)
  if(request.method==='DELETE'&&revokeSession){await store.revokeSession(user.id,revokeSession[1]);const current=revokeSession[1]===user.session.id;return ok(response,{revoked:true,current},requestId,200,current?{'set-cookie':clearSessionCookie({secure:secureCookie})}:undefined)}
  if(request.method==='GET'&&path==='/v1/maintenance/status')return ok(response,await store.maintenanceStatus(user.id),requestId)
  if(request.method==='GET'&&path==='/v1/system/alerts')return ok(response,await store.systemAlerts(user.id),requestId)
  if(request.method==='GET'&&path==='/v1/notifications')return ok(response,await store.notificationStatus(user.id,user.email),requestId)
  const uploadContent=path.match(/^\/v1\/uploads\/([^/]+)\/content$/)
  if(request.method==='PUT'&&uploadContent){
    const media=await store.mediaForUpload(user.id,uploadContent[1])
    if(Date.now()-new Date(media.createdAt).getTime()>30*60_000)return fail(response,410,'UPLOAD_EXPIRED','这次上传已经过期，请重新选择图片',requestId)
    const input=await bodyBufferOf(request,10*1024*1024,'图片超过 10MB 上限')
    if(input.length!==media.byteSize)return fail(response,400,'VALIDATION_FAILED','图片大小与上传申请不一致',requestId)
    if(createHash('sha256').update(input).digest('hex')!==media.sha256)return fail(response,400,'VALIDATION_FAILED','图片校验失败，请重新上传',requestId)
    if(String(request.headers['content-type']??'').split(';')[0].trim()!==media.contentType)return fail(response,400,'VALIDATION_FAILED','图片类型与上传申请不一致',requestId)
    let stored
    try { stored=await mediaStore.saveImage({spaceId:media.spaceId,mediaId:media.id,input}) }
    catch(error){if(error instanceof MediaProcessingError)return fail(response,400,'INVALID_IMAGE',error.message,requestId);throw error}
    try {
      const ready=await store.completeMedia(user.id,media.id,stored)
      return ok(response,{mediaId:ready.id,status:ready.status,privateUrl:`/v1/media/${ready.id}`,thumbnailUrl:`/v1/media/${ready.id}?variant=thumbnail`,width:ready.width,height:ready.height},requestId,201)
    } catch(error){await mediaStore.remove(stored);throw error}
  }
  const mediaRead=path.match(/^\/v1\/media\/([^/]+)$/)
  const mediaWithdraw=path.match(/^\/v1\/media\/([^/]+)\/withdraw$/)
  if(request.method==='POST'&&mediaWithdraw){const media=await store.withdrawMedia(user.id,mediaWithdraw[1]);return ok(response,{mediaId:media.id,visibility:'private'},requestId)}
  if(request.method==='DELETE'&&mediaRead){
    const media=await store.deleteMedia(user.id,mediaRead[1])
    await mediaStore.remove(media)
    return ok(response,{mediaId:media.id,deleted:true},requestId)
  }
  if(request.method==='GET'&&mediaRead){
    const media=await store.mediaForRead(user.id,mediaRead[1])
    const key=url.searchParams.get('variant')==='thumbnail'?media.thumbnailKey:media.objectKey
    if(!key)return fail(response,404,'NOT_FOUND','图片尚未处理完成',requestId)
    return sendBinary(response,await mediaStore.read(key),media.outputContentType??'image/webp')
  }
  const exportDownload=path.match(/^\/v1\/exports\/([^/]+)\/download$/)
  if(request.method==='GET'&&exportDownload){
    const job=await store.exportJobForRead(user.id,exportDownload[1]);const buffer=await exportStore.read(job.objectKey)
    return sendDownload(response,buffer,`quexin-space-export-${job.createdAt.slice(0,10)}.json.gz`)
  }
  if (request.method === 'GET' && path === '/v1/spaces/current') return ok(response, await store.currentSpace(user.id), requestId)
  if (request.method === 'POST' && path === '/v1/spaces') {
    if(!user.emailVerifiedAt)return fail(response,403,'EMAIL_NOT_VERIFIED','请先验证邮箱再创建情侣空间',requestId)
    const body = await bodyOf(request)
    const result = await store.createSpace(user.id, { name: String(body.name ?? '').trim().slice(0, 60) || '我们的空间', displayName: String(body.selfDisplayName ?? user.displayName).trim().slice(0, 30) || user.displayName })
    return ok(response, result, requestId, 201)
  }
  const accept = path.match(/^\/v1\/invites\/([^/]+)\/accept$/)
  if (request.method === 'POST' && accept) {
    if(!user.emailVerifiedAt)return fail(response,403,'EMAIL_NOT_VERIFIED','请先验证邮箱再加入情侣空间',requestId)
    const body = await bodyOf(request)
    return ok(response, await store.acceptInvite(user.id, decodeURIComponent(accept[1]).toUpperCase(), String(body.displayName ?? user.displayName).trim().slice(0, 30) || user.displayName), requestId)
  }
  const match = path.match(/^\/v1\/spaces\/([^/]+)(.*)$/)
  if (!match) return fail(response, 404, 'NOT_FOUND', '接口不存在', requestId)
  const [, spaceId, rest] = match
  if(request.method==='GET'&&rest==='/capsules')return ok(response,await store.capsulesFor(user.id,spaceId),requestId)
  if(request.method==='POST'&&rest==='/capsules'){
    if(!capsuleKey)return fail(response,503,'CAPSULE_NOT_CONFIGURED','服务端尚未配置安全胶囊密钥',requestId)
    const body=await bodyOf(request),title=String(body.title??'').trim(),content=String(body.body??'').trim(),unlockAt=String(body.unlockAt??''),visibility=body.visibility==='private'?'private':'shared',unlock=Date.parse(unlockAt)
    if(!title||title.length>80||!content||content.length>30000||!Number.isFinite(unlock)||unlock<=Date.now()||unlock>Date.now()+10*365*86400000)return fail(response,400,'VALIDATION_FAILED','请填写标题、正文和未来十年内的有效开启时间',requestId)
    const capsule=await store.createCapsule(user.id,spaceId,{title,unlockAt:new Date(unlock).toISOString(),visibility},encryptCapsule(content,capsuleKey));return ok(response,{id:capsule.id,title:capsule.title,unlockAt:capsule.unlockAt,visibility:capsule.visibility,createdAt:capsule.createdAt,canOpen:false},requestId,201)
  }
  const capsuleMatch=rest.match(/^\/capsules\/([^/]+)$/)
  if(request.method==='GET'&&capsuleMatch){if(!capsuleKey)return fail(response,503,'CAPSULE_NOT_CONFIGURED','服务端尚未配置安全胶囊密钥',requestId);const capsule=await store.capsuleForOpen(user.id,spaceId,capsuleMatch[1]);return ok(response,{id:capsule.id,title:capsule.title,unlockAt:capsule.unlockAt,visibility:capsule.visibility,createdAt:capsule.createdAt,body:decryptCapsule(capsule,capsuleKey)},requestId)}
  if(request.method==='DELETE'&&capsuleMatch)return ok(response,await store.deleteCapsule(user.id,spaceId,capsuleMatch[1]),requestId)
  if(request.method==='GET'&&rest==='/care')return ok(response,await store.careSignalsFor(user.id,spaceId),requestId)
  if(request.method==='POST'&&rest==='/care'){const body=await bodyOf(request);return ok(response,await store.publishCare(user.id,spaceId,{need:body.need,message:body.message,hours:body.hours}),requestId)}
  if(request.method==='DELETE'&&rest==='/care')return ok(response,await store.revokeCare(user.id,spaceId),requestId)
  if(request.method==='GET'&&rest==='/sharing')return ok(response,await store.sharing(user.id,spaceId),requestId)
  if(request.method==='POST'&&rest==='/withdraw'){
    const body=await bodyOf(request)
    if(!['record','plan','journal'].includes(body.entity)||typeof body.entityId!=='string'||body.entityId.length>160)return fail(response,400,'VALIDATION_FAILED','资料标识无效',requestId)
    const result=await store.sync(user.id,spaceId,[{commandId:randomUUID(),entity:body.entity,entityId:body.entityId,operation:'withdraw',expectedRevision:body.revision??null,payload:{},clientTime:new Date().toISOString()}])
    if(!result.accepted.length)return fail(response,404,'NOT_FOUND','资料不存在或无法撤回',requestId)
    return ok(response,{withdrawn:true,revision:result.accepted[0].revision},requestId)
  }
  if(request.method==='POST'&&rest==='/leave'){
    const body=await bodyOf(request),current=await store.currentSpace(user.id)
    if(current?.space.id!==spaceId)return fail(response,403,'FORBIDDEN','不在此空间',requestId)
    if(body.confirmation!==`退出 ${current.space.name}`)return fail(response,400,'CONFIRMATION_MISMATCH',`请输入“退出 ${current.space.name}”`,requestId)
    const removed=await store.endMembership(user.id,false)
    const cleanup=await Promise.allSettled([...removed.media.map(m=>mediaStore.remove(m)),...removed.exports.filter(j=>j.objectKey).map(j=>exportStore.remove(j.objectKey))])
    return ok(response,{left:true,spaceId,remainingMember:removed.remainingMember,cleanupPending:cleanup.some(r=>r.status==='rejected')},requestId)
  }
  if (request.method === 'GET' && rest === '/members') return ok(response, await store.listMembers(user.id, spaceId), requestId)
  if(request.method==='GET'&&rest==='/companion')return ok(response,await store.companion(user.id,spaceId),requestId)
  if(request.method==='POST'&&rest==='/companion/actions'){
    const action=await bodyOf(request)
    if(!action||typeof action!=='object'||Array.isArray(action))return fail(response,400,'VALIDATION_FAILED','操作内容无效',requestId)
    if(action.expectedUserId&&action.expectedUserId!==user.id)return fail(response,403,'FORBIDDEN','账号已切换，请重新打开当前空间',requestId)
    if(action.kind==='memory_growth')return fail(response,403,'FORBIDDEN','成长来源只能由已确认共同回忆产生',requestId)
    if(typeof action.commandId!=='string'||!(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i).test(action.commandId))return fail(response,400,'VALIDATION_FAILED','操作编号无效',requestId)
    return ok(response,await store.companionAction(user.id,spaceId,action),requestId)
  }
  if(request.method==='POST'&&rest==='/exports'){
    const job=await store.createExportJob(user.id,spaceId),snapshot=await store.exportSnapshot(user.id,spaceId)
    const media=[];let decodedBytes=0
    for(const item of snapshot.media){
      const original=item.objectKey?await mediaStore.read(item.objectKey):Buffer.alloc(0),thumbnail=item.thumbnailKey?await mediaStore.read(item.thumbnailKey):Buffer.alloc(0);decodedBytes+=original.length+thumbnail.length
      if(decodedBytes>80*1024*1024)throw new StoreError('EXPORT_TOO_LARGE','当前导出媒体超过 80MB 本机演示上限',413)
      media.push({...item,originalBase64:original.toString('base64'),thumbnailBase64:thumbnail.toString('base64')})
    }
    const companion=await store.companion(user.id,spaceId),capsuleMeta=await store.capsulesFor(user.id,spaceId),capsules=[]
    for(const item of capsuleMeta){if(item.canOpen&&capsuleKey){const opened=await store.capsuleForOpen(user.id,spaceId,item.id);capsules.push({...item,body:decryptCapsule(opened,capsuleKey)})}else capsules.push(item)}
    const payload={format:'quexin-space-export',version:1,exportedAt:new Date().toISOString(),space:snapshot.space,members:snapshot.members,records:snapshot.records,plans:snapshot.plans,journals:snapshot.journals,capsules,media,companion}
    const stored=await exportStore.write(job.id,payload),sha256=createHash('sha256').update(stored.buffer).digest('hex')
    let ready;try{ready=await store.completeExportJob(user.id,job.id,{objectKey:stored.key,sha256,byteSize:stored.buffer.length})}catch(error){await exportStore.remove(stored.key);throw error}
    return ok(response,{jobId:ready.id,status:ready.status,expiresAt:ready.expiresAt,downloadUrl:`/v1/exports/${ready.id}/download`,sha256:ready.sha256,byteSize:ready.byteSize},requestId,201)
  }
  if(request.method==='GET'&&rest==='/deletion')return ok(response,await store.deletionStatus(user.id,spaceId),requestId)
  if(request.method==='DELETE'&&rest===''){
    const body=await bodyOf(request),current=await store.currentSpace(user.id)
    if(!current||current.space.id!==spaceId)return fail(response,404,'NOT_FOUND','空间不存在',requestId)
    if(String(body.confirmation??'')!==current.space.name)return fail(response,400,'CONFIRMATION_MISMATCH','请输入完整空间名称确认',requestId)
    const deletion=await store.scheduleDeletion(user.id,spaceId);return ok(response,{deletionId:deletion.id,scheduledAt:deletion.scheduledAt},requestId,202)
  }
  if(request.method==='POST'&&rest==='/deletion/cancel')return ok(response,await store.cancelDeletion(user.id,spaceId),requestId)
  if(request.method==='DELETE'&&rest==='/deletion/now'){
    const body=await bodyOf(request),current=await store.currentSpace(user.id)
    if(!current||current.space.id!==spaceId)return fail(response,404,'NOT_FOUND','空间不存在',requestId)
    if(String(body.confirmation??'')!==`永久删除 ${current.space.name}`)return fail(response,400,'CONFIRMATION_MISMATCH',`请输入“永久删除 ${current.space.name}”`,requestId)
    const removed=await store.deleteSpaceNow(user.id,spaceId);await Promise.all(removed.media.map(item=>mediaStore.remove(item)));await Promise.all(removed.exports.map(item=>exportStore.remove(item.objectKey)))
    return ok(response,{deleted:true,spaceId},requestId)
  }
  if (request.method === 'POST' && rest === '/uploads') {
    const body=await bodyOf(request),filename=String(body.filename??'').trim().slice(0,180),contentType=String(body.contentType??'').toLowerCase(),byteSize=Number(body.size),sha256=String(body.sha256??'').toLowerCase(),visibility=body.scope==='private'?'private':'shared',entityType=body.entityType?String(body.entityType):null,entityId=body.entityId?String(body.entityId).slice(0,160):null
    const fieldErrors={}
    if(!filename)fieldErrors.filename='请选择图片'
    if(!['image/jpeg','image/png','image/webp'].includes(contentType))fieldErrors.contentType='仅支持 JPEG、PNG 或 WebP'
    if(!Number.isInteger(byteSize)||byteSize<1||byteSize>10*1024*1024)fieldErrors.size='图片大小需在 1B—10MB 之间'
    if(!/^[a-f0-9]{64}$/.test(sha256))fieldErrors.sha256='图片校验值无效'
    if(entityType&&!['record','journal'].includes(entityType))fieldErrors.entityType='媒体关联类型无效'
    if(Boolean(entityType)!==Boolean(entityId))fieldErrors.entityId='媒体关联类型和资料 ID 需要同时提供'
    if(Object.keys(fieldErrors).length)return fail(response,400,'VALIDATION_FAILED','请检查图片信息',requestId,{fieldErrors})
    const media=await store.createMedia(user.id,spaceId,{filename,contentType,byteSize,sha256,visibility,entityType,entityId})
    return ok(response,{mediaId:media.id,uploadUrl:`/v1/uploads/${media.id}/content`,method:'PUT',headers:{'content-type':media.contentType},expiresAt:new Date(Date.now()+30*60_000).toISOString()},requestId,201)
  }
  const completeUpload=rest.match(/^\/uploads\/([^/]+)\/complete$/)
  if(request.method==='POST'&&completeUpload){
    const media=await store.mediaForRead(user.id,completeUpload[1])
    if(media.spaceId!==spaceId)return fail(response,404,'NOT_FOUND','图片不存在',requestId)
    return ok(response,{mediaId:media.id,privateUrl:`/v1/media/${media.id}`,thumbnailUrl:`/v1/media/${media.id}?variant=thumbnail`},requestId)
  }
  if (request.method === 'POST' && rest === '/invites') {
    const body = await bodyOf(request), ttlHours = Math.min(168, Math.max(1, Number(body.ttlHours) || 24))
    return ok(response, await store.createInvite(user.id, spaceId, ttlHours), requestId, 201)
  }
  const revoke = rest.match(/^\/invites\/([^/]+)$/)
  if (request.method === 'DELETE' && revoke) return ok(response, await store.revokeInvite(user.id, spaceId, revoke[1]), requestId)
  if (request.method === 'POST' && rest === '/sync') {
    const body = await bodyOf(request), commands = Array.isArray(body.commands) ? body.commands : []
    if(body.expectedUserId&&body.expectedUserId!==user.id)return fail(response,403,'FORBIDDEN','账号已切换，已暂停旧账号的同步',requestId)
    return ok(response, await store.sync(user.id, spaceId, commands), requestId)
  }
  if (request.method === 'GET' && rest === '/sync/status') return ok(response,await store.syncStatus(user.id,spaceId),requestId)
  if (request.method === 'GET' && rest === '/changes') return ok(response, await store.changes(user.id, spaceId, Math.max(0, Number(url.searchParams.get('cursor')) || 0)), requestId)
  if(request.method==='POST'&&rest==='/media/cleanup'){
    const removed=await store.cleanupMedia(user.id,spaceId,100)
    await Promise.all(removed.map(media=>mediaStore.remove(media)))
    return ok(response,{removed:removed.length},requestId)
  }
  return fail(response, 404, 'NOT_FOUND', '接口不存在', requestId)
}

const server = createServer((request, response) => { void route(request, response).catch(error => {
  if (error instanceof StoreError) return fail(response, error.status, error.code, error.message, randomUUID())
  console.error(error)
  return fail(response, 500, 'INTERNAL_ERROR', '服务暂时不可用', randomUUID())
}) })
server.listen(port, host, () => console.log(`鹊信正式 API（${memory ? '内存测试' : 'PostgreSQL'}）：http://${host}:${port}`))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { void store.close().finally(() => process.exit(0)) }))
