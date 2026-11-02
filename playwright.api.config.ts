import { defineConfig } from '@playwright/test'

process.env.API_ORIGIN = 'http://127.0.0.1:4593'

export default defineConfig({
  testDir: './tests/api',
  testMatch: '**/*.spec.ts',
  outputDir: 'test-results/api',
  workers: 1,
  timeout: 20_000,
  use: { baseURL: process.env.API_ORIGIN, extraHTTPHeaders: { 'content-type': 'application/json' } },
  webServer: {
    command: 'env DEV_MAILBOX=true NOTIFICATION_ENCRYPTION_KEY=e2e-notification-key MEDIA_ROOT=test-results/api/media EXPORT_ROOT=test-results/api/exports node server/prod-server.mjs --memory --port 4593',
    url: 'http://127.0.0.1:4593/health',
    reuseExistingServer: false,
    timeout: 10_000,
  },
})
