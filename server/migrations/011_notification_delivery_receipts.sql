ALTER TABLE quexin.notification_jobs
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS accepted jsonb,
  ADD COLUMN IF NOT EXISTS rejected jsonb;
CREATE INDEX IF NOT EXISTS notification_jobs_provider_message_idx ON quexin.notification_jobs(provider_message_id) WHERE provider_message_id IS NOT NULL;
