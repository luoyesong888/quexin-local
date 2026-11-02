import {defineConfig} from '@playwright/test'
const postgres=process.env.CARE_HTTP_DATABASE_URL
if(postgres)process.env.DATABASE_URL=postgres
process.env.DEV_MAILBOX='true';process.env.NOTIFICATION_ENCRYPTION_KEY='care-test';process.env.PUBLIC_ORIGIN='http://127.0.0.1:6288'
export default defineConfig({testDir:'./tests/care',workers:1,timeout:45_000,expect:{timeout:10_000},outputDir:'test-results/care',use:{baseURL:'http://127.0.0.1:6288',trace:'retain-on-failure',screenshot:'only-on-failure'},webServer:[
 {command:`node server/prod-server.mjs ${postgres?'':'--memory'} --port 6293`,url:'http://127.0.0.1:6293/health',reuseExistingServer:false},
 {command:'env WEB_PORT=6288 FORMAL_API_TARGET=http://127.0.0.1:6293 vite --host 127.0.0.1 --strictPort',url:'http://127.0.0.1:6288/',reuseExistingServer:false},
]})
