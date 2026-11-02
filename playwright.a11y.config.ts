import {defineConfig} from '@playwright/test'

export default defineConfig({
  testDir:'./tests/a11y',workers:1,timeout:60_000,expect:{timeout:8_000},outputDir:'test-results/a11y',
  reporter:[['list'],['json',{outputFile:'test-results/a11y-results.json'}]],
  use:{baseURL:'http://127.0.0.1:6688',trace:'retain-on-failure',screenshot:'only-on-failure'},
  webServer:[
    {command:'env DEV_MAILBOX=true NOTIFICATION_ENCRYPTION_KEY=a11y-test-key CAPSULE_ENCRYPTION_KEY=a11y-capsule-key PUBLIC_ORIGIN=http://127.0.0.1:6688 node server/prod-server.mjs --memory --port 6693',url:'http://127.0.0.1:6693/health',reuseExistingServer:false},
    {command:'env WEB_PORT=6688 FORMAL_API_TARGET=http://127.0.0.1:6693 vite --host 127.0.0.1 --strictPort',url:'http://127.0.0.1:6688/',reuseExistingServer:false},
  ],
})
