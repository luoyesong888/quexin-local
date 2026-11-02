import {defineConfig} from '@playwright/test'
const postgres=process.env.LIFECYCLE_HTTP_DATABASE_URL
if(postgres)process.env.DATABASE_URL=postgres
process.env.DEV_MAILBOX='true';process.env.PUBLIC_ORIGIN='http://127.0.0.1:5888';process.env.NOTIFICATION_ENCRYPTION_KEY='lifecycle-test'
process.env.MEDIA_ROOT='test-results/lifecycle/media';process.env.EXPORT_ROOT='test-results/lifecycle/exports'
export default defineConfig({testDir:'./tests/lifecycle',workers:1,timeout:60_000,expect:{timeout:12_000},outputDir:'test-results/lifecycle',
 use:{baseURL:'http://127.0.0.1:5888',trace:'retain-on-failure',screenshot:'only-on-failure'},webServer:[
 {command:`node server/prod-server.mjs ${postgres?'':'--memory'} --port 5893`,url:'http://127.0.0.1:5893/health',reuseExistingServer:false},
 {command:'env WEB_PORT=5888 FORMAL_API_TARGET=http://127.0.0.1:5893 vite --host 127.0.0.1 --strictPort',url:'http://127.0.0.1:5888/',reuseExistingServer:false},
 ]})
