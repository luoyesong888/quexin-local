import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const port = 4192
const origin = `http://127.0.0.1:${port}`
const tempDir = await mkdtemp(join(tmpdir(), 'quexin-cloud-test-'))
const server = spawn(process.execPath, ['server/mock-server.mjs', '--port', String(port), '--data', join(tempDir, 'state.json')], { stdio: ['ignore', 'pipe', 'inherit'] })

const waitForServer = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('模拟服务启动超时')), 5000)
  server.stdout.on('data', chunk => { if (String(chunk).includes('本地模拟云服务')) { clearTimeout(timeout); resolve() } })
  server.on('exit', code => reject(new Error(`模拟服务提前退出：${code}`)))
})

function assert(value, message) { if (!value) throw new Error(message) }
async function request(path, { token = '', method = 'GET', body } = {}) {
  const response = await fetch(`${origin}${path}`, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return response.json()
}
async function login(name) {
  const result = await request('/v1/dev/sessions', { method: 'POST', body: { displayName: name } })
  assert(result.ok && result.data.token, `${name} 登录失败`)
  return result.data
}

try {
  await waitForServer
  const a = await login('测试甲')
  const b = await login('测试乙')
  const c = await login('无关用户')
  const created = await request('/v1/spaces', { token: a.token, method: 'POST', body: { name: '测试双人空间', selfDisplayName: '甲' } })
  assert(created.ok, '创建空间失败')
  const spaceId = created.data.space.id
  const invitation = await request(`/v1/spaces/${spaceId}/invites`, { token: a.token, method: 'POST', body: { ttlHours: 1 } })
  assert(invitation.ok && invitation.data.code, '生成邀请失败')
  const joined = await request(`/v1/invites/${invitation.data.code}/accept`, { token: b.token, method: 'POST', body: { displayName: '乙' } })
  assert(joined.ok && joined.data.members.length === 2, '第二位成员加入失败')
  const thirdDenied = await request(`/v1/spaces/${spaceId}/members`, { token: c.token })
  assert(!thirdDenied.ok && thirdDenied.error.code === 'FORBIDDEN', '第三位用户不应读取空间')

  const recordId = randomUUID()
  const commandId = randomUUID()
  const createRecord = { commandId, entity: 'record', entityId: recordId, operation: 'create', expectedRevision: null, payload: { title: '一起看海', body: '测试共享记录', date: '2026-10-28', kind: '回忆', source: '测试', status: 'confirmed', visibility: 'shared' }, clientTime: new Date().toISOString() }
  const firstSync = await request(`/v1/spaces/${spaceId}/sync`, { token: a.token, method: 'POST', body: { commands: [createRecord] } })
  assert(firstSync.ok && firstSync.data.accepted[0].revision === 1, '首次同步失败')
  const idempotent = await request(`/v1/spaces/${spaceId}/sync`, { token: a.token, method: 'POST', body: { commands: [createRecord] } })
  assert(idempotent.ok && idempotent.data.accepted[0].revision === 1, '幂等重试不应重复增加版本')
  const partnerChanges = await request(`/v1/spaces/${spaceId}/changes`, { token: b.token })
  assert(partnerChanges.ok && partnerChanges.data.records.some(item => item.id === recordId), '伴侣未收到共享记录')

  const partnerUpdate = await request(`/v1/spaces/${spaceId}/sync`, { token: b.token, method: 'POST', body: { commands: [{ ...createRecord, commandId: randomUUID(), operation: 'update', expectedRevision: 1, payload: { ...createRecord.payload, title: '乙修改后的海边' } }] } })
  assert(partnerUpdate.ok && partnerUpdate.data.accepted[0].revision === 2, '伴侣更新失败')
  const staleUpdate = await request(`/v1/spaces/${spaceId}/sync`, { token: a.token, method: 'POST', body: { commands: [{ ...createRecord, commandId: randomUUID(), operation: 'update', expectedRevision: 1, payload: { ...createRecord.payload, title: '甲的过期修改' } }] } })
  assert(staleUpdate.ok && staleUpdate.data.conflicts[0].actualRevision === 2, '过期版本应产生冲突')

  const privateId = randomUUID()
  await request(`/v1/spaces/${spaceId}/sync`, { token: a.token, method: 'POST', body: { commands: [{ ...createRecord, commandId: randomUUID(), entityId: privateId, payload: { ...createRecord.payload, title: '甲的私人记录', visibility: 'private' } }] } })
  const partnerAfterPrivate = await request(`/v1/spaces/${spaceId}/changes?cursor=${partnerChanges.data.nextCursor}`, { token: b.token })
  assert(partnerAfterPrivate.ok && !partnerAfterPrivate.data.records.some(item => item.id === privateId), '私人记录不应返回给伴侣')
  const thirdSync = await request(`/v1/spaces/${spaceId}/sync`, { token: c.token, method: 'POST', body: { commands: [] } })
  assert(!thirdSync.ok && thirdSync.error.code === 'FORBIDDEN', '第三位用户不应写入空间')

  console.log('本地模拟云契约测试通过：登录、邀请、双人成员、权限、幂等、增量同步、隐私与版本冲突')
} finally {
  server.kill('SIGTERM')
  await new Promise(resolve => server.once('exit', resolve))
  await rm(tempDir, { recursive: true, force: true })
}
