import {defineConfig,devices} from '@playwright/test'

export default defineConfig({
  testDir:'./tests/compat',workers:1,timeout:90_000,expect:{timeout:10_000},outputDir:'test-results/compat',
  reporter:[['list'],['json',{outputFile:'test-results/compat-results.json'}]],
  use:{baseURL:'http://127.0.0.1:6788',trace:'retain-on-failure',screenshot:'only-on-failure'},
  projects:[
    {name:'chromium-desktop',use:{...devices['Desktop Chrome']}},
    {name:'firefox-desktop',use:{...devices['Desktop Firefox']}},
    {name:'webkit-desktop',use:{...devices['Desktop Safari']}},
    {name:'pixel-chromium',use:{...devices['Pixel 7']}},
    {name:'iphone-webkit',use:{...devices['iPhone 13']}},
  ],
  webServer:[
    {command:'env DEV_MAILBOX=true NOTIFICATION_ENCRYPTION_KEY=compat-test-key CAPSULE_ENCRYPTION_KEY=compat-capsule-key PUBLIC_ORIGIN=http://127.0.0.1:6788 node server/prod-server.mjs --memory --port 6793',url:'http://127.0.0.1:6793/health',reuseExistingServer:false},
    {command:'env WEB_PORT=6788 FORMAL_API_TARGET=http://127.0.0.1:6793 vite --host 127.0.0.1 --strictPort',url:'http://127.0.0.1:6788/',reuseExistingServer:false},
  ],
})
