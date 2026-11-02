import test from 'node:test'
import assert from 'node:assert/strict'
import {validateRuntimeConfig,redactConnection} from '../server/lib/runtime-config.mjs'

const good={DATABASE_URL:'postgres://app:strong-password@db.example.test/quexin',MAINTENANCE_DATABASE_URL:'postgres://maint:strong-password@db.example.test/quexin',NOTIFICATION_DATABASE_URL:'postgres://notify:strong-password@db.example.test/quexin',PUBLIC_ORIGIN:'https://quexin.example.test',NOTIFICATION_ENCRYPTION_KEY:'a'.repeat(64),CAPSULE_ENCRYPTION_KEY:'b'.repeat(64),NOTIFICATION_DRIVER:'smtp',SMTP_URL:'smtps://mailer:secret@smtp.example.test:465',MAIL_FROM:'鹊信 <no-reply@example.test>'}

test('生产配置强制 HTTPS、独立密钥和完整 SMTP',()=>{const result=validateRuntimeConfig(good);assert.equal(result.ok,true);assert.equal(result.summary.errors,0)})
test('默认密钥、HTTP、密钥复用和缺 SMTP 会失败',()=>{const result=validateRuntimeConfig({...good,PUBLIC_ORIGIN:'http://quexin.example.test',NOTIFICATION_ENCRYPTION_KEY:'change-me',CAPSULE_ENCRYPTION_KEY:'change-me',SMTP_URL:''});assert.equal(result.ok,false);assert.ok(result.summary.errors>=4)})
test('本机模式只允许回环 HTTP，输出连接串会隐藏密码',()=>{const result=validateRuntimeConfig({...good,PUBLIC_ORIGIN:'http://127.0.0.1:4188',NOTIFICATION_DRIVER:'local',DEV_MAILBOX:'true'},{local:true});assert.equal(result.ok,true);assert.equal(redactConnection(good.DATABASE_URL).includes('strong-password'),false);assert.match(redactConnection(good.DATABASE_URL),/\*\*\*/ )})
