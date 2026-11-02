import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { AccountRoute } from './account-route'
import type { ApiResult } from './cloud-contract'
import { formalCloud } from './cloud-client'
import { Icon } from './ui'
import { announceAccount,prepareAccount } from './account-workspace'
import './account-page.css'

const headings = { verify: '确认你的邮箱', reset: '设置新密码', forgot: '找回密码', resend: '重新获取验证邮件', login: '登录鹊信' }
const descriptions = {
  verify: '确认后，即可创建或加入你们的共同空间。',
  reset: '为账号设置一个新密码，其他设备将需要重新登录。',
  forgot: '填写注册邮箱，我们会为你准备密码重置链接。',
  resend: '填写注册邮箱，使用最新一封邮件里的验证链接。',
  login: '登录账号，继续你们的故事。',
}

export function AccountPage({ route }: { route: AccountRoute }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [invalid, setInvalid] = useState(route.invalid)
  const [success, setSuccess] = useState(false)
  const [developmentMailbox, setDevelopmentMailbox] = useState(false)
  const [previewLink, setPreviewLink] = useState('')
  const inFlight = useRef(false)
  const token = useRef(route.token)
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    document.title = `鹊信 · ${headings[route.action]}`
    heading.current?.focus()
    let active = true
    void formalCloud.authConfig().then(result => { if (active && result.ok) setDevelopmentMailbox(result.data.developmentMailbox) })
    return () => { active = false }
  }, [route.action])

  function accept<T>(result: ApiResult<T>): T {
    if (!result.ok) {
      if (result.error.code === 'INVALID_TOKEN') { setInvalid(true); token.current = '' }
      throw new Error(result.error.message)
    }
    return result.data
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (inFlight.current) return
    setError('')
    if (route.action === 'reset' && password !== confirmation) { setError('两次输入的密码不一致，请重新检查。'); return }
    inFlight.current = true; setBusy(true)
    try {
      if (route.action === 'verify') accept(await formalCloud.verifyEmail(token.current))
      else if (route.action === 'reset') {
        accept(await formalCloud.resetPassword(token.current, password))
        announceAccount(null)
      } else if (route.action === 'forgot') accept(await formalCloud.forgotPassword(email))
      else if (route.action === 'resend') accept(await formalCloud.resendVerification(email))
      else {
        const session=accept(await formalCloud.login(email, password))
        await prepareAccount(session);announceAccount(session)
      }
      token.current = ''; setPassword(''); setConfirmation(''); setSuccess(true)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '暂时无法完成，请稍后重试。') }
    finally { inFlight.current = false; setBusy(false) }
  }

  async function previewMail() {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setError('')
    try {
      const kind = route.action === 'forgot' ? 'reset_password' : 'verify_email'
      const mail = accept(await formalCloud.devLatestToken(email, kind))
      setPreviewLink(`#account/${kind === 'reset_password' ? 'reset' : 'verify'}?token=${encodeURIComponent(mail.token)}`)
    } catch { setError('本机邮件箱中没有可用邮件，请核对邮箱后重新申请。') }
    finally { inFlight.current = false; setBusy(false) }
  }

  const requestMode = route.action === 'forgot' || route.action === 'resend'
  const successTitle = requestMode ? '请求已提交' : route.action === 'verify' ? '邮箱验证成功' : route.action === 'reset' ? '密码已重置' : '登录成功'
  const successText = requestMode
    ? `如果 ${email} 对应可用账号，链接将通过已配置的邮件通道发送。请留意最新邮件，也可以检查垃圾邮件。`
    : route.action === 'verify' ? '你可以继续使用当前账号，或返回登录。'
      : route.action === 'reset' ? '请使用新密码登录。旧密码和旧设备会话已失效。' : '你可以回到空间继续记录。'

  return <main className="account-page">
    <a className="account-brand" href="#today"><Icon name="bird" size={30} /><span>鹊信</span><small>把重要的人，好好记得</small></a>
    <section className="account-card" aria-labelledby="account-heading">
      <div className="account-symbol"><Icon name={success ? 'check' : route.action === 'verify' || route.action === 'resend' ? 'mail' : 'lock'} size={28} /></div>
      <h1 id="account-heading" ref={heading} tabIndex={-1}>{success ? successTitle : headings[route.action]}</h1>
      <p className="account-description">{success ? successText : descriptions[route.action]}</p>
      {error && <p className="account-error" role="alert">{error}</p>}
      {!success && invalid && <div className="account-expired" role="status"><h2>链接无效、已使用或已过期</h2><p>请从最新邮件重新打开。刷新页面后如丢失链接，也可以重新申请。</p><a className="btn primary" href={route.action === 'reset' ? '#account/forgot' : '#account/resend'}>重新申请链接</a></div>}
      {!success && !invalid && <form onSubmit={event => void submit(event)} className="account-form">
        {(requestMode || route.action === 'login') && <label className="field"><span>注册邮箱</span><input type="email" required maxLength={254} autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" /></label>}
        {(route.action === 'reset' || route.action === 'login') && <label className="field"><span id="account-password-label">{route.action === 'reset' ? '新密码' : '密码'}</span><input type="password" aria-labelledby="account-password-label" aria-describedby="account-password-hint" required minLength={10} maxLength={128} autoComplete={route.action === 'reset' ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} /><small id="account-password-hint">10—128 个字符</small></label>}
        {route.action === 'reset' && <label className="field"><span>再次输入新密码</span><input type="password" required minLength={10} maxLength={128} autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>}
        <button className="btn primary" type="submit" disabled={busy}>{busy ? '正在处理…' : route.action === 'verify' ? '确认验证邮箱' : route.action === 'reset' ? '保存新密码' : route.action === 'login' ? '登录' : '发送链接'}</button>
      </form>}
      {success && <div className="account-result" role="status">
        <Icon name="check" size={18} /><span>{requestMode ? '请使用最新收到的链接。' : '已完成，可以继续。'}</span>
      </div>}
      {success && requestMode && developmentMailbox && <details className="account-local-preview"><summary>本机演示：查看邮件</summary><p>当前开发环境可在这里打开邮件链接。</p><button className="btn secondary" disabled={busy} onClick={() => void previewMail()}>读取本机邮件</button>{previewLink && <a className="account-link" href={previewLink}>打开邮件中的链接</a>}</details>}
      <nav className="account-links" aria-label="账号操作">
        {route.action !== 'login' && <a href="#account/login">返回登录</a>}
        {route.action === 'login' && !success && <a href="#account/forgot">忘记密码</a>}
        {success && requestMode && <button type="button" className="account-text-button" onClick={() => { setSuccess(false); setError(''); setPreviewLink('') }}>重新申请</button>}
        <a href="#settings" onClick={event => { event.preventDefault(); window.history.pushState({ quexinIntent: 'space' }, '', '#settings'); window.dispatchEvent(new PopStateEvent('popstate')) }}>返回空间</a>
      </nav>
    </section>
    <p className="account-footer">鹊信 · 让普通的日子，也值得珍藏</p>
  </main>
}
