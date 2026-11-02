import {defineConfig} from '@playwright/test'
export default defineConfig({
  testDir:'./tests/visual',workers:1,timeout:60_000,expect:{timeout:5000},outputDir:'test-results/visual',
  reporter:[['list'],['json',{outputFile:'test-results/visual-results.json'}]],
  use:{baseURL:'http://127.0.0.1:4888',trace:'retain-on-failure',screenshot:'only-on-failure'},
  webServer:[
    {command:'env DEV_MAILBOX=true NOTIFICATION_ENCRYPTION_KEY=visual-test-key PUBLIC_ORIGIN=http://127.0.0.1:4888 node server/prod-server.mjs --memory --port 4893',url:'http://127.0.0.1:4893/health',reuseExistingServer:false},
    {command:'env WEB_PORT=4888 FORMAL_API_TARGET=http://127.0.0.1:4893 vite --host 127.0.0.1 --strictPort',url:'http://127.0.0.1:4888/',reuseExistingServer:false},
  ],
})
