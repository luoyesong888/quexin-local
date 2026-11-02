import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir:'./tests/e2e',
  testMatch:'**/*.spec.ts',
  outputDir:'test-results/e2e',
  workers:1,
  timeout:45_000,
  expect:{timeout:8_000},
  reporter:[['list']],
  use:{baseURL:'http://127.0.0.1:4288',trace:'retain-on-failure',screenshot:'only-on-failure'},
  webServer:[
    {command:'env DEV_MAILBOX=true NOTIFICATION_ENCRYPTION_KEY=e2e-notification-key PUBLIC_ORIGIN=http://127.0.0.1:4288 node server/prod-server.mjs --memory --port 4293',url:'http://127.0.0.1:4293/health',reuseExistingServer:false,timeout:15_000},
    {command:'env WEB_PORT=4288 FORMAL_API_TARGET=http://127.0.0.1:4293 vite --host 127.0.0.1 --strictPort',url:'http://127.0.0.1:4288/',reuseExistingServer:false,timeout:15_000},
  ],
})
