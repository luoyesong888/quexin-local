ALTER TABLE quexin.notification_jobs
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;

CREATE INDEX IF NOT EXISTS notification_jobs_stale_sending_idx
  ON quexin.notification_jobs(claimed_at)
  WHERE status='sending';
