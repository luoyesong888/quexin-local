import {defineConfig} from '@playwright/test'
export default defineConfig({
 testDir:'./tests/release',workers:1,timeout:45_000,expect:{timeout:8000},outputDir:'test-results/release',
 use:{baseURL:'http://127.0.0.1:5088',trace:'retain-on-failure',screenshot:'only-on-failure'},
 webServer:[
  {command:'env DEV_MAILBOX=true NOTIFICATION_ENCRYPTION_KEY=release-test-key PUBLIC_ORIGIN=http://127.0.0.1:5088 node server/prod-server.mjs --memory --port 5093',url:'http://127.0.0.1:5093/health',reuseExistingServer:false},
  {command:'env WEB_PORT=5088 FORMAL_API_TARGET=http://127.0.0.1:5093 vite --host 127.0.0.1 --strictPort',url:'http://127.0.0.1:5088/',reuseExistingServer:false},
 ],
})
