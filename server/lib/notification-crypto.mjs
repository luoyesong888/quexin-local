import { createCipheriv,createDecipheriv,createHash,randomBytes } from 'node:crypto'

function keyFrom(secret){if(!secret)throw new Error('通知队列需要 NOTIFICATION_ENCRYPTION_KEY');return createHash('sha256').update(secret).digest()}
export function encryptNotification(payload,secret){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',keyFrom(secret),iv),ciphertext=Buffer.concat([cipher.update(JSON.stringify(payload),'utf8'),cipher.final()]);return{ciphertext:ciphertext.toString('base64'),iv:iv.toString('base64'),authTag:cipher.getAuthTag().toString('base64')}}
export function decryptNotification(job,secret){const decipher=createDecipheriv('aes-256-gcm',keyFrom(secret),Buffer.from(job.iv,'base64'));decipher.setAuthTag(Buffer.from(job.authTag??job.auth_tag,'base64'));return JSON.parse(Buffer.concat([decipher.update(Buffer.from(job.ciphertext,'base64')),decipher.final()]).toString('utf8'))}
