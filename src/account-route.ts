export type AccountAction = 'verify' | 'reset' | 'forgot' | 'resend' | 'login'
export type AccountRoute = { action: AccountAction; token: string; invalid: boolean }

// 新邮件把令牌放在 fragment，兼容以前已生成的 query 链接。
export function readAccountRoute(url: URL): AccountRoute | null {
  const legacyVerify = url.searchParams.getAll('verify_email')
  const legacyReset = url.searchParams.getAll('reset_password')
  const match = url.hash.match(/^#account\/(verify|reset|forgot|resend|login)(?:\?(.*))?$/)
  const legacy = legacyVerify.length + legacyReset.length > 0
  if (!legacy && !match) return null
  const action = (legacy ? legacyVerify.length ? 'verify' : 'reset' : match![1]) as AccountAction
  const tokens = legacy ? [...legacyVerify, ...legacyReset] : new URLSearchParams(match?.[2] ?? '').getAll('token')
  const needsToken = action === 'verify' || action === 'reset'
  return { action, token: tokens[0] ?? '', invalid: needsToken && (tokens.length !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(tokens[0])) }
}

export function scrubAccountUrl(route: AccountRoute): void {
  const url = new URL(window.location.href)
  url.searchParams.delete('verify_email')
  url.searchParams.delete('reset_password')
  url.hash = `account/${route.action}`
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
}
