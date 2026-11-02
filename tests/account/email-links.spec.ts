import { expect, test, type APIRequestContext } from '@playwright/test'
import { z } from 'zod'
import { renderNotification } from '../../server/lib/notification-templates.mjs'

const api = 'http://127.0.0.1:4493/v1'
const password = 'account-test-password-2026'
const mailSchema = z.object({ ok: z.literal(true), data: z.object({ token: z.string(), expiresAt: z.string() }), requestId: z.string() })
async function register(request: APIRequestContext) {
  const email = `account-${crypto.randomUUID()}@example.test`
  const response = await request.post(`${api}/auth/register`, { data: { email, password, displayName: '账号验收' } })
  expect(response.status()).toBe(201)
  return email
}
async function mail(request: APIRequestContext, email: string, purpose = 'verify_email') {
  return mailSchema.parse(await (await request.get(`${api}/dev/mailbox/latest?email=${encodeURIComponent(email)}&purpose=${purpose}`)).json()).data
}
function link(kind: string, message: { token: string; expiresAt: string }) {
  const template = renderNotification(kind, message, { origin: 'http://127.0.0.1:4488' })
  return template.text.match(/http:\/\/[^\s]+/)![0]
}

test('新浏览器直接打开模板验证链接，确认后才消耗令牌，重复使用被拒绝', async ({ page, request }) => {
  const email = await register(request), message = await mail(request, email)
  await page.goto(link('verify_email', message))
  await expect(page.getByRole('heading', { name: '确认你的邮箱' })).toBeVisible()
  await expect(page).toHaveURL('http://127.0.0.1:4488/#account/verify')
  const before = await request.get(`${api}/session`)
  expect((await before.json()).data.emailVerified).toBe(false)
  await page.getByRole('button', { name: '确认验证邮箱' }).click()
  await expect(page.getByRole('heading', { name: '邮箱验证成功' })).toBeVisible()
  expect((await (await request.get(`${api}/session`)).json()).data.emailVerified).toBe(true)
  await page.goto(link('verify_email', message))
  await page.getByRole('button', { name: '确认验证邮箱' }).click()
  await expect(page.getByText('链接无效、已使用或已过期', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: '重新申请链接' })).toHaveAttribute('href', '#account/resend')
})

test('兼容旧 query 验证链接，进入页面即清除 URL 令牌', async ({ page, request }) => {
  const email = await register(request), message = await mail(request, email)
  await page.goto(`/?verify_email=${message.token}#settings`)
  await expect(page).toHaveURL('http://127.0.0.1:4488/#account/verify')
  await page.getByRole('button', { name: '确认验证邮箱' }).click()
  await expect(page.getByRole('heading', { name: '邮箱验证成功' })).toBeVisible()
})

test('手机端走通申请重置、确认密码、旧会话撤销及新密码登录', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const email = await register(request)
  await page.goto('/#account/forgot')
  await page.getByLabel('注册邮箱').fill(email)
  await page.getByRole('button', { name: '发送链接' }).click()
  await expect(page.getByRole('heading', { name: '请求已提交' })).toBeVisible()
  const message = await mail(request, email, 'reset_password'), newPassword = 'account-new-password-2026'
  await page.goto(link('reset_password', message))
  await expect(page).toHaveURL('http://127.0.0.1:4488/#account/reset')
  await expect(page.getByLabel('新密码', { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('mobile-reset.png'), fullPage: true })
  await page.getByLabel('新密码', { exact: true }).fill(newPassword)
  await page.getByLabel('再次输入新密码').fill('password-does-not-match')
  await page.getByRole('button', { name: '保存新密码' }).click()
  await expect(page.getByRole('alert')).toContainText('两次输入的密码不一致')
  expect((await request.get(`${api}/session`)).status()).toBe(200)
  await page.getByLabel('再次输入新密码').fill(newPassword)
  await page.getByRole('button', { name: '保存新密码' }).click()
  await expect(page.getByRole('heading', { name: '密码已重置' })).toBeVisible()
  expect((await request.get(`${api}/session`)).status()).toBe(401)
  expect((await request.post(`${api}/auth/login`, { data: { email, password } })).status()).toBe(401)
  await page.getByRole('link', { name: '返回登录' }).click()
  await page.getByLabel('注册邮箱').fill(email)
  await page.getByLabel('密码', { exact: true }).fill(newPassword)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('heading', { name: '登录成功' })).toBeVisible()
  await page.goto(link('reset_password', message))
  await page.getByLabel('新密码', { exact: true }).fill('another-password-2026')
  await page.getByLabel('再次输入新密码').fill('another-password-2026')
  await page.getByRole('button', { name: '保存新密码' }).click()
  await expect(page.getByText('链接无效、已使用或已过期', { exact: true })).toBeVisible()
})

test('新验证邮件使旧链接失效，未知邮箱只显示通用提示', async ({ page, request }) => {
  const email = await register(request), oldMail = await mail(request, email)
  await page.goto('/#account/resend')
  await page.getByLabel('注册邮箱').fill(email)
  await page.getByRole('button', { name: '发送链接' }).click()
  await expect(page.getByRole('heading', { name: '请求已提交' })).toBeVisible()
  const latest = await mail(request, email)
  expect(latest.token).not.toBe(oldMail.token)
  await page.goto(link('verify_email', oldMail))
  await page.getByRole('button', { name: '确认验证邮箱' }).click()
  await expect(page.getByRole('alert')).toContainText('验证链接无效或已经过期')
  await page.goto(link('verify_email', latest))
  await page.getByRole('button', { name: '确认验证邮箱' }).click()
  await expect(page.getByRole('heading', { name: '邮箱验证成功' })).toBeVisible()
  await page.goto('/#account/resend')
  await page.getByLabel('注册邮箱').fill('unknown-account@example.test')
  await page.getByRole('button', { name: '发送链接' }).click()
  await expect(page.getByRole('heading', { name: '请求已提交' })).toBeVisible()
  await expect(page.getByText(/如果 unknown-account/)).toBeVisible()
  await page.getByRole('button', { name: '重新申请', exact: true }).click()
  await expect(page.getByRole('button', { name: '发送链接' })).toBeVisible()
})

test('请求中断可重试，刷新后的缺失令牌不重复提交', async ({ page, request }) => {
  const email = await register(request), message = await mail(request, email)
  await page.route('**/formal/v1/auth/email/verify', route => route.abort(), { times: 1 })
  await page.goto(link('verify_email', message))
  await page.getByRole('button', { name: '确认验证邮箱' }).click()
  await expect(page.getByRole('alert')).toContainText('API')
  await page.getByRole('button', { name: '确认验证邮箱' }).click()
  await expect(page.getByRole('heading', { name: '邮箱验证成功' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('link', { name: '重新申请链接' })).toBeVisible()
  await expect(page.getByRole('button', { name: '确认验证邮箱' })).toHaveCount(0)
})

test('异常或双重令牌拒绝提交，正常入口无需开发邮箱', async ({ page }) => {
  await page.goto('/?verify_email=bad&reset_password=bad#settings')
  await expect(page.getByText('链接无效、已使用或已过期', { exact: true })).toBeVisible()
  await page.route('**/formal/v1/auth/config', route => route.fulfill({ json: { ok: true, data: { developmentMailbox: false }, requestId: 'config-off' } }))
  await page.goto('/#account/forgot')
  await page.getByLabel('注册邮箱').fill('unknown-reset@example.test')
  await page.getByRole('button', { name: '发送链接' }).click()
  await expect(page.getByRole('heading', { name: '请求已提交' })).toBeVisible()
  await expect(page.getByText('本机演示：查看邮件')).toHaveCount(0)
})

test('从现有设置注册，经邮件链接验证后回到原空间继续操作', async ({ page, request }) => {
  const email = `settings-${crypto.randomUUID()}@example.test`
  await page.goto('/#settings')
  await page.getByRole('button', { name: '先用虚构资料体验完整功能' }).click()
  await page.getByRole('button', { name: '空间与功能' }).click()
  const lab = page.getByTestId('sync-lab')
  await lab.getByLabel('邮箱').fill(email)
  await lab.getByLabel('你的称呼').fill('链接用户')
  await lab.getByLabel('密码').fill(password)
  await lab.getByRole('button', { name: '注册并登录' }).click()
  await expect(lab.getByRole('heading', { name: '先验证邮箱' })).toBeVisible()
  await lab.getByRole('button', { name: '重新发送验证邮件' }).click()
  await expect(page.getByRole('status')).toContainText('验证链接已加入发送队列')
  const message = await mail(request, email)
  await page.goto(link('verify_email', message))
  await page.getByRole('button', { name: '确认验证邮箱' }).click()
  await expect(page.getByRole('heading', { name: '邮箱验证成功' })).toBeVisible()
  await page.getByRole('link', { name: '返回空间' }).click()
  await expect(lab.getByRole('heading', { name: '创建情侣空间' })).toBeVisible()
  await expect(page.getByRole('button', { name: '先用虚构资料体验完整功能' })).toHaveCount(0)
  await lab.getByRole('button', { name: '退出', exact: true }).click()
  await lab.getByRole('button', { name: '登录', exact: true }).click()
  await lab.getByRole('link', { name: '忘记密码？通过邮件重置' }).click()
  await expect(page.getByRole('heading', { name: '找回密码' })).toBeVisible()
  await page.getByLabel('注册邮箱').fill(email)
  await page.getByRole('button', { name: '发送链接' }).click()
  await page.getByText('本机演示：查看邮件', { exact: true }).click()
  await page.getByRole('button', { name: '读取本机邮件' }).click()
  await page.getByRole('link', { name: '打开邮件中的链接' }).click()
  await expect(page.getByRole('heading', { name: '设置新密码' })).toBeVisible()
})
