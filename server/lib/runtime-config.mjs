const loopback=host=>['localhost','127.0.0.1','::1'].includes(host)
const check=(id,status,message)=>({id,status,message})
const value=source=>typeof source==='string'?source.trim():''
const strongSecret=(secret)=>secret.length>=32&&!/replace|change-me|dev-only|example|password/i.test(secret)

export function validateRuntimeConfig(environment=process.env,{local=false}={}){
  const checks=[]
  const add=(id,ok,message,level='error')=>checks.push(check(id,ok?'pass':level,message))
  const url=(name,input,protocols,{required=true}={})=>{
    const raw=value(input)
    if(!raw){add(name,!required,`${name} ${required?'缺失':'未配置'}`,required?'error':'warning');return null}
    try{const parsed=new URL(raw);add(name,protocols.includes(parsed.protocol),`${name} 协议${protocols.includes(parsed.protocol)?'有效':'不受支持'}`);return parsed}catch{add(name,false,`${name} 不是有效 URL`);return null}
  }
  const database=url('DATABASE_URL',environment.DATABASE_URL,['postgres:','postgresql:'])
  url('MAINTENANCE_DATABASE_URL',environment.MAINTENANCE_DATABASE_URL,['postgres:','postgresql:'])
  url('NOTIFICATION_DATABASE_URL',environment.NOTIFICATION_DATABASE_URL??environment.MAINTENANCE_DATABASE_URL,['postgres:','postgresql:'])
  const origin=url('PUBLIC_ORIGIN',environment.PUBLIC_ORIGIN,['https:',...(local?['http:']:[])])
  if(origin)add('public-origin-policy',local?loopback(origin.hostname):origin.protocol==='https:',local?'本地来源仅允许回环地址':'生产来源必须使用 HTTPS')
  if(database){const credentials=Boolean(database.username&&database.password),localTrust=local&&loopback(database.hostname)&&Boolean(database.username);checks.push(check('app-database-credentials',credentials?'pass':localTrust?'warning':'error',credentials?'应用数据库连接包含独立凭据':localTrust?'本机回环数据库使用无密码连接；公网部署不可沿用':'应用数据库连接缺少用户名或密码'))}
  const notificationKey=value(environment.NOTIFICATION_ENCRYPTION_KEY),capsuleKey=value(environment.CAPSULE_ENCRYPTION_KEY)
  checks.push(check('notification-key',strongSecret(notificationKey)?'pass':local&&notificationKey?'warning':'error',strongSecret(notificationKey)?'通知密钥强度符合要求':local&&notificationKey?'本机沿用旧通知密钥；公网部署前必须轮换并重加密待发送任务':'通知密钥至少 32 个随机字符且不能使用示例值'))
  checks.push(check('capsule-key',strongSecret(capsuleKey)?'pass':local&&capsuleKey?'warning':'error',strongSecret(capsuleKey)?'胶囊密钥强度符合要求':local&&capsuleKey?'本机沿用旧胶囊密钥；公网部署前必须完成密文重加密':'胶囊密钥至少 32 个随机字符且不能使用示例值'))
  add('separate-keys',Boolean(notificationKey&&capsuleKey&&notificationKey!==capsuleKey),'通知与胶囊必须使用不同密钥')
  const driver=value(environment.NOTIFICATION_DRIVER)||'local'
  add('notification-driver',['local','json','smtp','webhook'].includes(driver),`通知驱动：${driver}`)
  if(driver==='smtp'){
    url('SMTP_URL',environment.SMTP_URL,['smtp:','smtps:'])
    add('MAIL_FROM',/^.+<[^<>\s]+@[^<>\s]+>$/.test(value(environment.MAIL_FROM)), 'MAIL_FROM 需要“名称 <邮箱>”格式')
  }
  if(driver==='webhook')url('NOTIFICATION_WEBHOOK_URL',environment.NOTIFICATION_WEBHOOK_URL,['https:'])
  const assistantConfigured=[environment.ASSISTANT_API_URL,environment.ASSISTANT_API_KEY,environment.ASSISTANT_MODEL].some(Boolean)
  if(assistantConfigured){url('ASSISTANT_API_URL',environment.ASSISTANT_API_URL,['https:']);add('assistant-key',Boolean(value(environment.ASSISTANT_API_KEY)),'模型服务端密钥已配置');add('assistant-model',Boolean(value(environment.ASSISTANT_MODEL)),'模型名称已配置')}
  else checks.push(check('assistant','warning','真实模型未配置，保持待验收'))
  add('development-mailbox',local||environment.DEV_MAILBOX!=='true',local?'本地模式允许开发邮件箱':'生产环境不得启用开发邮件箱')
  return{ok:!checks.some(item=>item.status==='error'),checks,summary:{passed:checks.filter(item=>item.status==='pass').length,warnings:checks.filter(item=>item.status==='warning').length,errors:checks.filter(item=>item.status==='error').length}}
}

export function redactConnection(input){
  try{const url=new URL(String(input));if(url.username)url.username=encodeURIComponent(url.username);if(url.password)url.password='***';return `${url.protocol}//${url.username?`${decodeURIComponent(url.username)}:***@`:''}${url.host}${url.pathname}`}
  catch{return input?'[已隐藏]':'[未配置]'}
}
