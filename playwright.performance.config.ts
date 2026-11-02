import {defineConfig} from '@playwright/test'

export default defineConfig({
  testDir:'./tests/performance',workers:1,timeout:120_000,expect:{timeout:12_000},outputDir:'test-results/performance',
  reporter:[['list'],['json',{outputFile:'test-results/performance-results.json'}]],
  use:{baseURL:'http://127.0.0.1:6888',trace:'retain-on-failure',screenshot:'only-on-failure'},
  webServer:[
    {command:'env DEV_MAILBOX=true NOTIFICATION_ENCRYPTION_KEY=performance-test-key CAPSULE_ENCRYPTION_KEY=performance-capsule-key PUBLIC_ORIGIN=http://127.0.0.1:6888 node server/prod-server.mjs --memory --port 6893',url:'http://127.0.0.1:6893/health',reuseExistingServer:false},
    {command:'env WEB_PORT=6888 FORMAL_API_TARGET=http://127.0.0.1:6893 vite --host 127.0.0.1 --strictPort',url:'http://127.0.0.1:6888/',reuseExistingServer:false},
  ],
})
