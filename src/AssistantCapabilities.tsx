import {useEffect,useState} from 'react'
import type {FormEvent} from 'react'
import type {AssistantAdminConfig,AssistantModelConfig} from './model-assistant'
import {getAssistantAdminConfig,getAssistantModelConfig,ModelAssistantError,updateAssistantAdminConfig} from './model-assistant'
import type {DemoStore} from './domain'

const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))

export function AssistantCapabilities({mode,consent,config,notify}:{mode:DemoStore['settings']['aiMode'];consent:boolean;config:AssistantModelConfig|null;notify?:(message:string)=>void}){
 const real=mode==='model'&&consent&&config?.enabled
 const [admin,setAdmin]=useState<AssistantAdminConfig|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false)
 const [enabled,setEnabled]=useState(false),[provider,setProvider]=useState<'deepseek'|'openai-compatible'>('deepseek'),[apiUrl,setApiUrl]=useState('https://api.deepseek.com'),[apiKey,setApiKey]=useState(''),[model,setModel]=useState('deepseek-flash'),[transcriptionModel,setTranscriptionModel]=useState(''),[password,setPassword]=useState(''),[message,setMessage]=useState(''),[error,setError]=useState('')
 useEffect(()=>{let active=true;void getAssistantAdminConfig().then(value=>{if(!active)return;setAdmin(value);setEnabled(value.enabled);setProvider(value.provider);setApiUrl(value.provider==='deepseek'?'https://api.deepseek.com':value.apiUrl);setModel(value.model||(value.provider==='deepseek'?'deepseek-flash':''));setTranscriptionModel(value.transcriptionModel)}).catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'无法读取 API 配置')}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[])
 const selectProvider=(value:'deepseek'|'openai-compatible')=>{setProvider(value);if(value==='deepseek'){setApiUrl('https://api.deepseek.com');setModel('deepseek-flash');setTranscriptionModel('')}else{setApiUrl(admin?.provider==='openai-compatible'?admin.apiUrl:'https://api.openai.com/v1');setModel(admin?.provider==='openai-compatible'?admin.model:'');setTranscriptionModel(admin?.provider==='openai-compatible'?admin.transcriptionModel:'')}}
 const waitForRestart=async(expected:{enabled:boolean;model:string})=>{const deadline=Date.now()+35_000;await delay(1800);while(Date.now()<deadline){try{const value=await getAssistantModelConfig();if(value.enabled===expected.enabled&&(!expected.enabled||value.model===expected.model)){window.location.reload();return}}catch{}await delay(700)}setBusy(false);setMessage('配置已安全保存，但没有等到服务恢复。请运行 npm run local:status；必要时执行 npm run local:start。')}
 const save=async(event:FormEvent)=>{event.preventDefault();setError('');setMessage('');if(!password){setError('请输入当前账号密码');return}setBusy(true);try{const saved=await updateAssistantAdminConfig({enabled,provider,apiUrl,apiKey,model,transcriptionModel,currentPassword:password});setAdmin(saved);setApiKey('');setPassword('');if(saved.restarting){setMessage('配置已安全保存，本地服务正在自动重启。页面会在恢复后刷新…');notify?.('API 配置已保存，青鸟助手正在重启');void waitForRestart({enabled:saved.enabled,model:saved.model})}else{setBusy(false);setMessage('配置已保存。请重启本地服务后生效：npm run local:stop，再运行 npm run local:start。')}}catch(cause){setBusy(false);setError(cause instanceof ModelAssistantError?cause.message:'无法保存 API 配置')}}
 return <section className="panel assistant-capabilities" aria-label="青鸟能力状态">
  <div className="assistant-capability-heading"><div><span className="life-kicker">本机能力</span><h3>青鸟现在能做什么</h3></div><span className={`tag ${config?.enabled?'is-ready':''}`}>{config?.enabled?'模型已接入':'本地模式'}</span></div>
  <dl>
   <div><dt>本地候选与检索</dt><dd>{mode==='off'?'已关闭自动整理，仍可手动记录':mode==='demo'?'本地规则已开启':'模型失败时作为回退'}</dd></div>
   <div><dt>回答范围</dt><dd>只选择已确认、非私密记录与日程；发送前再次展示标题</dd></div>
   <div><dt>大模型</dt><dd>{config?.enabled?real?`${config.provider} · ${config.model} 已启用`:`${config.model} 已配置，尚未启用或未同意发送`:'服务端尚未配置；不会产生外部模型请求'}</dd></div>
   <div><dt>模型密钥</dt><dd>只保存在本机服务端环境，不下发浏览器、同步空间或备份</dd></div>
   <div><dt>图片文字识别（OCR）</dt><dd>{config?.ocrEnabled?`${config.model} 已配置；结果必须人工校正`:'服务端未配置支持图片的模型；仍可上传后人工填写'}</dd></div>
   <div><dt>录音转写</dt><dd>{config?.transcriptionEnabled?`${config.transcriptionModel} 已配置；结果必须人工校正`:'服务端未配置；不会发送录音'}</dd></div>
   <div><dt>Agent 与 Skill</dt><dd>{config?.enabled?'10 个内置 Skill：零资料指令、个人记忆/计划/创作、导入发现、图片流水线、计划跟进、日历/邮件草稿和多轮回顾；所有动作逐项审批':'接入模型后可启用；本地模式不会自行运行 Agent'}</dd></div>
   <div><dt>青鸟交互</dt><dd>统一聊天入口；问答、附件、资料确认、审批、结果和引用都在同一消息流，不再区分功能页</dd></div>
   <div><dt>普通对话与产品控制</dt><dd>{config?.enabled?'可进行有限上下文自然对话，并通过白名单工具导航页面、照顾小鹊、切换个人设置和导出资料':'能力说明和本地资料检索可用；自然对话与工具规划需接入模型'}</dd></div>
   <div><dt>微信聊天提取</dt><dd>等待经过验收的 WorkBuddy 提取适配器；当前不注册微信 Skill，不会扫描或伪装读取聊天记录</dd></div>
   <div><dt>微信</dt><dd>支持主动粘贴、文件导入与虚构样例，未连接微信账号</dd></div>
  </dl>
  <p>{config?.enabled?`单次最多 ${config.maxSources} 条来源，每条最多 ${config.maxSourceChars} 字。结构错误、超时、拒绝或虚假引用会停止采用模型答案。`:'在下方接入 DeepSeek 或兼容 Responses API 后，才会出现真实模型选项。'}</p>
  <div className="assistant-api-settings">
   <div className="assistant-api-title"><div><span className="life-kicker">仅本机管理员</span><h3>模型 API 接入口</h3></div>{admin?.hasApiKey&&<span className="tag">密钥已保存</span>}</div>
   {loading?<p className="assistant-api-note">正在读取本机配置…</p>:!admin?<p className="assistant-api-note">请先在上方“共享与账号管理”登录正式本地账号，再配置模型 API。</p>:!admin.available?<p className="assistant-api-note">当前不是由鹊信本地启动器管理的服务。请使用 <code>npm run local:start</code> 启动后再配置。</p>:<form className="assistant-api-form" onSubmit={save}>
    <div className="assistant-api-switch"><span><strong>启用外部模型</strong><small>关闭后保留本地规则，API Key 会从本机配置中移除。</small></span><label className="life-toggle"><input type="checkbox" aria-label="启用外部模型" checked={enabled} onChange={event=>setEnabled(event.target.checked)}/><span/></label></div>
    <div className="assistant-api-grid">
     <label className="field"><span>服务商</span><select aria-label="服务商" value={provider} disabled={!enabled||busy} onChange={event=>selectProvider(event.target.value as 'deepseek'|'openai-compatible')}><option value="deepseek">DeepSeek（推荐预设）</option><option value="openai-compatible">OpenAI 兼容接口</option></select></label>
     <label className="field"><span>模型</span>{provider==='deepseek'?<select aria-label="模型" value={model} disabled={!enabled||busy} onChange={event=>setModel(event.target.value)}><option value="deepseek-flash">deepseek-flash（含图片输入）</option><option value="deepseek-v4-pro">deepseek-v4-pro（文本推理）</option></select>:<input aria-label="模型" value={model} disabled={!enabled||busy} maxLength={120} onChange={event=>setModel(event.target.value)} placeholder="例如 gpt-5-mini"/>}</label>
     <label className="field assistant-api-wide"><span>API 地址</span><input type="url" value={apiUrl} readOnly={provider==='deepseek'} disabled={!enabled||busy} onChange={event=>setApiUrl(event.target.value)} placeholder="https://api.example.com/v1"/><small>{provider==='deepseek'?'使用 DeepSeek 官方 Responses API 地址。':'只允许 HTTPS；本机兼容服务可使用 127.0.0.1 / localhost 的 HTTP。'}</small></label>
     <label className="field assistant-api-wide"><span>API Key</span><input type="password" autoComplete="new-password" value={apiKey} disabled={!enabled||busy} maxLength={512} onChange={event=>setApiKey(event.target.value)} placeholder={admin.hasApiKey?'已配置；留空可保持原密钥':'请输入 API Key'}/><small>页面不会回显或保存到浏览器；提交后只写入本机 600 权限配置文件。</small></label>
     {provider==='openai-compatible'&&<label className="field assistant-api-wide"><span>录音转写模型（可选）</span><input value={transcriptionModel} disabled={!enabled||busy} maxLength={120} onChange={event=>setTranscriptionModel(event.target.value)} placeholder="留空则不发送录音"/></label>}
     {provider==='deepseek'&&enabled&&<p className="assistant-api-note assistant-api-wide">DeepSeek 当前用于青鸟问答、整理和图片文字识别；录音转写保持关闭，不会发送录音。</p>}
     <label className="field assistant-api-wide"><span>当前账号密码</span><input type="password" autoComplete="current-password" required value={password} disabled={busy} maxLength={128} onChange={event=>setPassword(event.target.value)} placeholder="保存前再次确认是你本人"/></label>
    </div>
    <div className="assistant-api-actions"><span>启用后，只有你在每次任务中确认的资料片段才会发送给所选服务。</span><button className="btn primary" type="submit" disabled={busy||!password||Boolean(enabled&&(!model||(!apiKey&&!admin.hasApiKey)))}>{busy?'正在保存并重启…':'保存 API 配置'}</button></div>
    {message&&<p className="assistant-api-success" role="status">{message}</p>}{error&&<p className="assistant-api-error" role="alert">{error}</p>}
   </form>}
   {!loading&&!admin&&error&&<p className="assistant-api-error" role="alert">{error}</p>}
  </div>
 </section>
}
