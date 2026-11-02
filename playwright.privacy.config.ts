import {defineConfig} from '@playwright/test'
export default defineConfig({
 testDir:'./tests/privacy',testMatch:'**/*.spec.ts',workers:1,timeout:45_000,expect:{timeout:10_000},outputDir:'test-results/privacy',
 use:{baseURL:'http://127.0.0.1:5788',trace:'retain-on-failure',screenshot:'only-on-failure'},
 webServer:[
  {command:'env DEV_MAILBOX=true NOTIFICATION_ENCRYPTION_KEY=privacy-test PUBLIC_ORIGIN=http://127.0.0.1:5788 node server/prod-server.mjs --memory --port 5793',url:'http://127.0.0.1:5793/health',reuseExistingServer:false},
  {command:'env WEB_PORT=5788 FORMAL_API_TARGET=http://127.0.0.1:5793 vite --host 127.0.0.1 --strictPort',url:'http://127.0.0.1:5788/',reuseExistingServer:false},
 ],
})
