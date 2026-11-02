import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir:'./tests/pwa',
  testMatch:'**/*.spec.ts',
  outputDir:'test-results/pwa',
  workers:1,
  timeout:60_000,
  expect:{timeout:12_000},
  reporter:[['list']],
  use:{baseURL:'http://127.0.0.1:4388',trace:'retain-on-failure',screenshot:'only-on-failure',serviceWorkers:'allow'},
  webServer:[
    {command:'env DEV_MAILBOX=true NOTIFICATION_ENCRYPTION_KEY=e2e-notification-key PUBLIC_ORIGIN=http://127.0.0.1:4388 node server/prod-server.mjs --memory --port 4393',url:'http://127.0.0.1:4393/health',reuseExistingServer:false,timeout:15_000},
    {command:'env FORMAL_API_TARGET=http://127.0.0.1:4393 vite preview --host 127.0.0.1 --port 4388 --strictPort',url:'http://127.0.0.1:4388/',reuseExistingServer:false,timeout:15_000},
  ],
})
