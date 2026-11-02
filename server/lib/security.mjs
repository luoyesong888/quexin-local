import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)

export async function hashPassword(password) {
  const salt = randomBytes(16)
  const key = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
  return `scrypt$16384$8$1$${salt.toString('base64url')}$${Buffer.from(key).toString('base64url')}`
}

export async function verifyPassword(password, encoded) {
  try {
    const [algorithm, n, r, p, saltValue, keyValue] = String(encoded).split('$')
    if (algorithm !== 'scrypt') return false
    const expected = Buffer.from(keyValue, 'base64url')
    const actual = Buffer.from(await scrypt(password, Buffer.from(saltValue, 'base64url'), expected.length, {
      N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
    }))
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  } catch { return false }
}

export function newSessionToken() { return randomBytes(32).toString('base64url') }
export function hashToken(token) { return createHash('sha256').update(token).digest('hex') }

export function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const index = part.indexOf('=')
    return index < 0 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))]
  }))
}

export function sessionCookie(token, { secure = false, maxAge = 7 * 24 * 60 * 60 } = {}) {
  return [`qx_session=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`, secure ? 'Secure' : ''].filter(Boolean).join('; ')
}

export function clearSessionCookie({ secure = false } = {}) {
  return [`qx_session=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0', secure ? 'Secure' : ''].filter(Boolean).join('; ')
}

export function normalizeEmail(value) { return String(value ?? '').trim().toLowerCase() }
export function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254 }
export function validPassword(value) { return typeof value === 'string' && value.length >= 10 && value.length <= 128 }
