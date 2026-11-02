import {defineConfig} from '@playwright/test'
export default defineConfig({
  testDir:'./tests/couple',workers:1,timeout:60_000,expect:{timeout:12_000},outputDir:'test-results/couple',
  use:{baseURL:'http://127.0.0.1:4688',trace:'retain-on-failure',screenshot:'only-on-failure'},
  webServer:[
    {command:'env DEV_MAILBOX=true NOTIFICATION_ENCRYPTION_KEY=couple-test-key PUBLIC_ORIGIN=http://127.0.0.1:4688 node server/prod-server.mjs --memory --port 4693',url:'http://127.0.0.1:4693/health',reuseExistingServer:false},
    {command:'env WEB_PORT=4688 FORMAL_API_TARGET=http://127.0.0.1:4693 vite --host 127.0.0.1 --strictPort',url:'http://127.0.0.1:4688/',reuseExistingServer:false}
  ]
})
