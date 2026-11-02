import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/account',
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  outputDir: 'test-results/account',
  use: { baseURL: 'http://127.0.0.1:4488', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: [
    { command: 'env DEV_MAILBOX=true NOTIFICATION_ENCRYPTION_KEY=account-test-key PUBLIC_ORIGIN=http://127.0.0.1:4488 node server/prod-server.mjs --memory --port 4493', url: 'http://127.0.0.1:4493/health', reuseExistingServer: false },
    { command: 'env WEB_PORT=4488 FORMAL_API_TARGET=http://127.0.0.1:4493 vite --host 127.0.0.1 --strictPort', url: 'http://127.0.0.1:4488/', reuseExistingServer: false },
  ],
})
