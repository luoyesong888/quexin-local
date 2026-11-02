import {defineConfig} from '@playwright/test'
const postgres=process.env.CREATION_HTTP_DATABASE_URL;if(postgres)process.env.DATABASE_URL=postgres
process.env.DEV_MAILBOX='true';process.env.NOTIFICATION_ENCRYPTION_KEY='creation-notification';process.env.CAPSULE_ENCRYPTION_KEY='creation-capsule-key';process.env.PUBLIC_ORIGIN='http://127.0.0.1:6488';process.env.ASSISTANT_API_URL='http://127.0.0.1:6494/v1';process.env.ASSISTANT_API_KEY='assistant-test-key';process.env.ASSISTANT_MODEL='test-structured-model'
export default defineConfig({testDir:'./tests/creation',workers:1,timeout:60_000,expect:{timeout:12_000},outputDir:'test-results/creation',use:{baseURL:'http://127.0.0.1:6488',trace:'retain-on-failure',screenshot:'only-on-failure'},webServer:[
 {command:'env FAKE_MODEL_PORT=6494 node tests/ai/fake-provider.mjs',url:'http://127.0.0.1:6494/health',reuseExistingServer:false},
 {command:`node server/prod-server.mjs ${postgres?'':'--memory'} --port 6493`,url:'http://127.0.0.1:6493/health',reuseExistingServer:false},
 {command:'env WEB_PORT=6488 FORMAL_API_TARGET=http://127.0.0.1:6493 vite --host 127.0.0.1 --strictPort',url:'http://127.0.0.1:6488/',reuseExistingServer:false},
]})
