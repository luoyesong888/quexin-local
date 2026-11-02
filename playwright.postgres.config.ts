import { defineConfig } from '@playwright/test'

process.env.API_ORIGIN = 'http://127.0.0.1:4194'
if(!process.env.API_TEST_DATABASE_URL)throw new Error('请设置隔离测试库 API_TEST_DATABASE_URL，不能使用现有业务库。')
process.env.DATABASE_URL=process.env.API_TEST_DATABASE_URL
process.env.PUBLIC_ORIGIN=process.env.API_ORIGIN
process.env.DEV_MAILBOX='true'
process.env.NOTIFICATION_ENCRYPTION_KEY='e2e-notification-key'
process.env.MEDIA_ROOT='test-results/postgres/media'
process.env.EXPORT_ROOT='test-results/postgres/exports'

export default defineConfig({
  testDir: './tests/api',
  testMatch: '**/*.spec.ts',
  workers: 1,
  outputDir:'test-results/postgres',
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:4194', extraHTTPHeaders: { 'content-type': 'application/json' } },
  webServer: {
    command: 'node server/prod-server.mjs --port 4194',
    url: 'http://127.0.0.1:4194/health',
    reuseExistingServer: false,
    timeout: 15_000,
  },
})
