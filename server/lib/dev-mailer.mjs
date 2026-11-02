export class DevMailer {
  constructor(enabled = false) { this.enabled = enabled; this.messages = [] }
  async send({ email, purpose, token, expiresAt }) {
    if (!this.enabled) {
      console.log(`[mail placeholder] ${purpose} -> ${email}; configure a real mail provider before production`)
      return
    }
    this.messages.push({ id: crypto.randomUUID(), email, purpose, token, expiresAt, createdAt: new Date().toISOString() })
  }
  latest(email, purpose) {
    return this.messages.filter(message => message.email === email && message.purpose === purpose).at(-1) ?? null
  }
}
