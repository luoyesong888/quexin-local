import {defineConfig} from '@playwright/test'
export default defineConfig({testDir:'./tests/workbuddy',testMatch:'**/*.spec.ts',workers:1,timeout:60_000,expect:{timeout:12_000},outputDir:'test-results/workbuddy',
 use:{baseURL:'http://127.0.0.1:6188',viewport:{width:1500,height:1000},trace:'retain-on-failure',screenshot:'only-on-failure'},webServer:[
  {command:'env FAKE_MODEL_PORT=6194 node tests/ai/fake-provider.mjs',url:'http://127.0.0.1:6194/health',reuseExistingServer:false},
  {command:'env DEV_MAILBOX=true NOTIFICATION_ENCRYPTION_KEY=wb-test ASSISTANT_API_URL=http://127.0.0.1:6194/v1 ASSISTANT_API_KEY=assistant-test-key ASSISTANT_MODEL=test-structured-model PUBLIC_ORIGIN=http://127.0.0.1:6188 node tests/workbuddy/server.mjs',url:'http://127.0.0.1:6193/health',reuseExistingServer:false},
  {command:'env WEB_PORT=6188 FORMAL_API_TARGET=http://127.0.0.1:6193 vite --host 127.0.0.1 --strictPort',url:'http://127.0.0.1:6188/',reuseExistingServer:false},
 ]})
