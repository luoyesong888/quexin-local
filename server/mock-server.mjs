import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const args = process.argv.slice(2)
const valueAfter = (flag, fallback) => { const index = args.indexOf(flag); return index >= 0 && args[index + 1] ? args[index + 1] : fallback }
const port = Number(valueAfter('--port', '4191'))
const dataPath = resolve(valueAfter('--data', '.local-data/mock-cloud.json'))
const host = valueAfter('--host', '127.0.0.1')
const emptyState = () => ({ users: {}, sessions: {}, spaces: {}, members: {}, invites: {}, entities: {}, events: {}, processedCommands: {} })
let state = emptyState()
let writeQueue = Promise.resolve()

async function loadState() {
  try { state = { ...emptyState(), ...JSON.parse(await readFile(dataPath, 'utf8')) } }
  catch (error) { if (error?.code !== 'ENOENT') throw error }
}

function persist() {
  const snapshot = JSON.stringify(state, null, 2)
  writeQueue = writeQueue.then(async () => {
    await mkdir(dirname(dataPath), { recursive: true })
    const temp = `${dataPath}.${process.pid}.tmp`
    await writeFile(temp, snapshot, { mode: 0o600 })
    await rename(temp, dataPath)
  })
  return writeQueue
}

const send = (response, status, payload) => {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  response.end(JSON.stringify(payload))
}
const ok = (response, data, requestId, status = 200) => send(response, status, { ok: true, data, requestId })
const fail = (response, status, code, message, requestId, extra = {}) => send(response, status, { ok: false, error: { code, message, requestId, ...extra } })

async function bodyOf(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 2 * 1024 * 1024) throw Object.assign(new Error('请求内容超过 2MB'), { status: 413, code: 'VALIDATION_FAILED' })
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw Object.assign(new Error('JSON 格式无效'), { status: 400, code: 'VALIDATION_FAILED' }) }
}

function sessionOf(request) {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, '')
  const session = token ? state.sessions[token] : null
  return session && session.expiresAt > new Date().toISOString() ? { ...session, token } : null
}

function membership(spaceId, userId) { return (state.members[spaceId] ?? []).find(member => member.userId === userId) }
function currentMembership(userId) {
  for (const [spaceId, members] of Object.entries(state.members)) {
    const member = members.find(item => item.userId === userId)
    if (member) return { spaceId, member }
  }
  return null
}
function requireSession(request, response, requestId) {
  const session = sessionOf(request)
  if (!session) fail(response, 401, 'UNAUTHENTICATED', '请先登录本地模拟账号', requestId)
  return session
}
function requireMember(request, response, requestId, spaceId, owner = false) {
  const session = requireSession(request, response, requestId)
  if (!session) return null
  const member = membership(spaceId, session.userId)
  if (!member || (owner && member.role !== 'owner')) {
    fail(response, 403, 'FORBIDDEN', owner ? '只有空间创建者可以执行此操作' : '你不是这个情侣空间的成员', requestId)
    return null
  }
  return { session, member }
}
function spaceData(spaceId) {
  state.entities[spaceId] ??= { record: {}, plan: {}, journal: {}, pet_action: {}, space_settings: {} }
  state.events[spaceId] ??= []
  state.processedCommands[spaceId] ??= {}
  return state.entities[spaceId]
}
function publicMember(member) { return { spaceId: member.spaceId, userId: member.userId, role: member.role, displayName: member.displayName, joinedAt: member.joinedAt } }
function visibleTo(entity, userId) { return entity.visibility !== 'private' || entity.ownerId === userId }

async function route(request, response) {
  const requestId = randomUUID()
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
  const path = url.pathname
  if (request.method === 'GET' && path === '/health') return ok(response, { status: 'ok', service: 'quexin-mock-cloud' }, requestId)

  if (request.method === 'POST' && path === '/v1/dev/sessions') {
    const body = await bodyOf(request)
    const displayName = String(body.displayName ?? '').trim().slice(0, 30)
    if (!displayName) return fail(response, 400, 'VALIDATION_FAILED', '请输入模拟账号名称', requestId, { fieldErrors: { displayName: '必填' } })
    const userId = randomUUID()
    const token = randomUUID().replaceAll('-', '')
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    state.users[userId] = { id: userId, displayName, createdAt: new Date().toISOString() }
    state.sessions[token] = { userId, displayName, expiresAt }
    await persist()
    return ok(response, { token, session: { userId, displayName, expiresAt } }, requestId, 201)
  }

  const session = requireSession(request, response, requestId)
  if (!session) return
  if (request.method === 'GET' && path === '/v1/session') return ok(response, { userId: session.userId, displayName: session.displayName, expiresAt: session.expiresAt }, requestId)
  if (request.method === 'GET' && path === '/v1/spaces/current') {
    const current = currentMembership(session.userId)
    if (!current) return ok(response, null, requestId)
    return ok(response, { space: state.spaces[current.spaceId], members: state.members[current.spaceId].map(publicMember) }, requestId)
  }

  if (request.method === 'POST' && path === '/v1/spaces') {
    if (currentMembership(session.userId)) return fail(response, 409, 'VALIDATION_FAILED', '当前模拟账号已经加入一个空间', requestId)
    const body = await bodyOf(request)
    const name = String(body.name ?? '').trim().slice(0, 60) || '我们的空间'
    const displayName = String(body.selfDisplayName ?? session.displayName).trim().slice(0, 30) || session.displayName
    const id = randomUUID()
    const createdAt = new Date().toISOString()
    const space = { id, name, createdAt, revision: 0 }
    const member = { spaceId: id, userId: session.userId, role: 'owner', displayName, joinedAt: createdAt }
    state.spaces[id] = space
    state.members[id] = [member]
    spaceData(id)
    await persist()
    return ok(response, { space, member: publicMember(member) }, requestId, 201)
  }

  const accept = path.match(/^\/v1\/invites\/([^/]+)\/accept$/)
  if (request.method === 'POST' && accept) {
    if (currentMembership(session.userId)) return fail(response, 409, 'VALIDATION_FAILED', '当前模拟账号已经加入一个空间', requestId)
    const invite = state.invites[decodeURIComponent(accept[1]).toUpperCase()]
    if (!invite || invite.status !== 'pending' || invite.expiresAt <= new Date().toISOString()) return fail(response, 410, 'INVITE_EXPIRED', '邀请码无效或已经过期', requestId)
    const members = state.members[invite.spaceId] ?? []
    if (members.length >= 2) return fail(response, 409, 'SPACE_FULL', '这个空间已经有两位成员', requestId)
    const body = await bodyOf(request)
    const member = { spaceId: invite.spaceId, userId: session.userId, role: 'partner', displayName: String(body.displayName ?? session.displayName).trim().slice(0, 30) || session.displayName, joinedAt: new Date().toISOString() }
    members.push(member)
    invite.status = 'accepted'
    invite.acceptedBy = session.userId
    await persist()
    return ok(response, { space: state.spaces[invite.spaceId], members: members.map(publicMember) }, requestId)
  }

  const spaceRoute = path.match(/^\/v1\/spaces\/([^/]+)(.*)$/)
  if (!spaceRoute) return fail(response, 404, 'NOT_FOUND', '接口不存在', requestId)
  const spaceId = spaceRoute[1]
  const rest = spaceRoute[2]

  if (request.method === 'GET' && rest === '/members') {
    if (!requireMember(request, response, requestId, spaceId)) return
    return ok(response, (state.members[spaceId] ?? []).map(publicMember), requestId)
  }
  if (request.method === 'POST' && rest === '/invites') {
    if (!requireMember(request, response, requestId, spaceId, true)) return
    const body = await bodyOf(request)
    const ttlHours = Math.min(168, Math.max(1, Number(body.ttlHours) || 24))
    for (const invite of Object.values(state.invites)) if (invite.spaceId === spaceId && invite.status === 'pending') invite.status = 'revoked'
    let code
    do { code = Math.random().toString(36).slice(2, 8).toUpperCase() } while (state.invites[code])
    const invite = { id: randomUUID(), code, spaceId, status: 'pending', createdBy: session.userId, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString() }
    state.invites[code] = invite
    await persist()
    return ok(response, invite, requestId, 201)
  }
  const revoke = rest.match(/^\/invites\/([^/]+)$/)
  if (request.method === 'DELETE' && revoke) {
    if (!requireMember(request, response, requestId, spaceId, true)) return
    const invite = Object.values(state.invites).find(item => item.spaceId === spaceId && item.id === revoke[1])
    if (!invite) return fail(response, 404, 'NOT_FOUND', '没有找到这个邀请', requestId)
    invite.status = 'revoked'
    await persist()
    return ok(response, invite, requestId)
  }

  if (request.method === 'POST' && rest === '/sync') {
    if (!requireMember(request, response, requestId, spaceId)) return
    const body = await bodyOf(request)
    const commands = Array.isArray(body.commands) ? body.commands.slice(0, 100) : []
    const entities = spaceData(spaceId)
    const accepted = []
    const conflicts = []
    for (const command of commands) {
      if (!command?.commandId || !command.entityId || !entities[command.entity]) continue
      const done = state.processedCommands[spaceId][command.commandId]
      if (done) { accepted.push(done); continue }
      const bucket = entities[command.entity]
      const current = bucket[command.entityId]
      const actualRevision = current?.revision ?? 0
      const expected = command.expectedRevision
      const valid = command.operation === 'create' ? !current && expected === null : current && actualRevision === expected
      if (!valid) {
        conflicts.push({ commandId: command.commandId, entity: command.entity, entityId: command.entityId, expectedRevision: expected ?? null, actualRevision, serverValue: current ?? null })
        continue
      }
      const revision = actualRevision + 1
      const updatedAt = new Date().toISOString()
      const visibility = ['private', 'shared', 'pending_partner', 'sealed_secret'].includes(command.payload?.visibility) ? command.payload.visibility : 'shared'
      if (command.operation === 'delete') bucket[command.entityId] = { ...current, deletedAt: updatedAt, revision, updatedAt }
      else bucket[command.entityId] = { ...command.payload, id: command.entityId, ownerId: current?.ownerId ?? session.userId, spaceId, visibility, revision, updatedAt, deletedAt: null }
      const event = { id: String(state.events[spaceId].length + 1), entity: command.entity, entityId: command.entityId, revision, operation: command.operation, updatedAt, ownerId: session.userId, visibility }
      state.events[spaceId].push(event)
      state.spaces[spaceId].revision += 1
      const result = { commandId: command.commandId, entityId: command.entityId, revision, updatedAt }
      state.processedCommands[spaceId][command.commandId] = result
      accepted.push(result)
    }
    await persist()
    return ok(response, { accepted, conflicts, cursor: String(state.events[spaceId].length) }, requestId)
  }

  if (request.method === 'GET' && rest === '/changes') {
    if (!requireMember(request, response, requestId, spaceId)) return
    const cursor = Math.max(0, Number(url.searchParams.get('cursor')) || 0)
    const entities = spaceData(spaceId)
    const events = state.events[spaceId].slice(cursor).filter(event => event.visibility !== 'private' || event.ownerId === session.userId)
    const ids = { record: new Set(), plan: new Set(), journal: new Set() }
    for (const event of events) if (ids[event.entity]) ids[event.entity].add(event.entityId)
    const collect = type => [...ids[type]].map(id => entities[type][id]).filter(entity => entity && visibleTo(entity, session.userId))
    return ok(response, { records: collect('record'), plans: collect('plan'), journals: collect('journal'), events, nextCursor: String(state.events[spaceId].length) }, requestId)
  }

  return fail(response, 404, 'NOT_FOUND', '接口不存在', requestId)
}

await loadState()
const server = createServer((request, response) => { void route(request, response).catch(error => fail(response, error.status ?? 500, error.code ?? 'INTERNAL_ERROR', error.message ?? '服务异常', randomUUID())) })
server.listen(port, host, () => console.log(`鹊信本地模拟云服务：http://${host}:${port}`))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)))
