import {defineConfig} from '@playwright/test'
export default defineConfig({testDir:'./tests/ai',testMatch:'**/*.spec.ts',workers:1,timeout:45_000,expect:{timeout:10_000},outputDir:'test-results/ai',
 use:{baseURL:'http://127.0.0.1:6088',trace:'retain-on-failure',screenshot:'only-on-failure'},webServer:[
  {command:'node tests/ai/fake-provider.mjs',url:'http://127.0.0.1:6094/health',reuseExistingServer:false},
  {command:'env DEV_MAILBOX=true NOTIFICATION_ENCRYPTION_KEY=ai-test ASSISTANT_API_URL=http://127.0.0.1:6094/v1 ASSISTANT_API_KEY=assistant-test-key ASSISTANT_MODEL=test-structured-model ASSISTANT_TRANSCRIPTION_MODEL=test-transcribe ASSISTANT_TIMEOUT_MS=1200 OPTIONAL_CONFIG_PATH=test-results/ai/.env.local OPTIONAL_CONFIG_BACKUP_ROOT=test-results/ai/config-backups PUBLIC_ORIGIN=http://127.0.0.1:6088 node server/prod-server.mjs --memory --port 6093',url:'http://127.0.0.1:6093/health',reuseExistingServer:false},
  {command:'env WEB_PORT=6088 FORMAL_API_TARGET=http://127.0.0.1:6093 vite --host 127.0.0.1 --strictPort',url:'http://127.0.0.1:6088/',reuseExistingServer:false},
 ]})
