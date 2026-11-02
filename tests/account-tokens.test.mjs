import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { MemoryStore } from '../server/lib/memory-store.mjs'
import { PostgresStore } from '../server/lib/postgres-store.mjs'

const backends = [['memory', () => new MemoryStore()]]
if (process.env.ACCOUNT_TEST_DATABASE_URL) backends.push(['postgres', () => new PostgresStore(process.env.ACCOUNT_TEST_DATABASE_URL)])

for (const [backend, createStore] of backends) {
  test(`${backend}: 账号令牌的过期、单次使用和事务回滚`, async t => {
    const store = createStore(), users = []
    const user = async () => {
      const value = await store.createUser({ email: `account-unit-${randomUUID()}@example.test`, displayName: '令牌测试', passwordHash: 'old-password-hash' })
      users.push(value.id); return value
    }
    const token = (userId, purpose, expiry = Date.now() + 60_000) => store.createAccountToken({ userId, purpose, tokenHash: randomUUID().replaceAll('-', '').padEnd(64, 'a'), expiresAt: new Date(expiry).toISOString() })
    const issue = async (userId, purpose, hash, expiry = Date.now() + 60_000) => store.createAccountToken({ userId, purpose, tokenHash: hash, expiresAt: new Date(expiry).toISOString() })
    try {
      await t.test('过期验证和过期重置不会修改账号', async () => {
        const member = await user(), hash = 'a'.repeat(64)
        await issue(member.id, 'verify_email', hash, Date.now() - 1_000)
        assert.equal(await store.verifyEmailToken(hash), null)
        assert.equal((await store.userById(member.id)).emailVerifiedAt, null)
        await issue(member.id, 'reset_password', 'b'.repeat(64), Date.now() - 1_000)
        assert.equal(await store.resetPasswordWithToken('b'.repeat(64), 'new'), null)
        assert.equal((await store.userById(member.id)).passwordHash, 'old-password-hash')
      })
      await t.test('错误用途不消耗令牌，并发验证只能成功一次', async () => {
        const member = await user(), hash = 'c'.repeat(64)
        await issue(member.id, 'verify_email', hash)
        assert.equal(await store.resetPasswordWithToken(hash, 'new'), null)
        const result = await Promise.all([store.verifyEmailToken(hash), store.verifyEmailToken(hash)])
        assert.equal(result.filter(Boolean).length, 1)
        assert.ok((await store.userById(member.id)).emailVerifiedAt)
      })
      await t.test('更新失败保留重置令牌，成功时同时撤销所有会话', async () => {
        const member = await user(), hash = 'd'.repeat(64), sessionHash = 'e'.repeat(64)
        await store.createSession({ userId: member.id, tokenHash: sessionHash, expiresAt: new Date(Date.now() + 60_000).toISOString() })
        await issue(member.id, 'reset_password', hash)
        await assert.rejects(() => store.resetPasswordWithToken(hash, null))
        assert.ok(await store.sessionByHash(sessionHash))
        assert.equal((await store.userById(member.id)).passwordHash, 'old-password-hash')
        assert.ok(await store.resetPasswordWithToken(hash, 'new-password-hash'))
        assert.equal(await store.sessionByHash(sessionHash), null)
        assert.equal((await store.userById(member.id)).passwordHash, 'new-password-hash')
        assert.equal(await store.resetPasswordWithToken(hash, 'another'), null)
      })
      await t.test('新申请使旧令牌失效', async () => {
        const member = await user(), hash = 'f'.repeat(64)
        await issue(member.id, 'verify_email', hash)
        await token(member.id, 'verify_email')
        assert.equal(await store.verifyEmailToken(hash), null)
      })
    } finally {
      if (backend === 'postgres') await store.pool.query('DELETE FROM quexin.app_users WHERE id=ANY($1::uuid[])', [users])
      await store.close()
    }
  })
}
