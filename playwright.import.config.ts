import {defineConfig} from '@playwright/test'
export default defineConfig({
  testDir:'./tests/import',workers:1,timeout:40_000,expect:{timeout:8000},outputDir:'test-results/import',
  use:{baseURL:'http://127.0.0.1:4788',trace:'retain-on-failure',screenshot:'only-on-failure'},
  webServer:[
    {command:'env DEV_MAILBOX=true NOTIFICATION_ENCRYPTION_KEY=import-test-key PUBLIC_ORIGIN=http://127.0.0.1:4788 node server/prod-server.mjs --memory --port 4793',url:'http://127.0.0.1:4793/health',reuseExistingServer:false},
    {command:'env WEB_PORT=4788 FORMAL_API_TARGET=http://127.0.0.1:4793 vite --host 127.0.0.1 --strictPort',url:'http://127.0.0.1:4788/',reuseExistingServer:false}
  ]
})
