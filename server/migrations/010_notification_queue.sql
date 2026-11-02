CREATE TABLE IF NOT EXISTS quexin.notification_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('verify_email','reset_password','system_alert')),
  ciphertext text NOT NULL,
  iv varchar(24) NOT NULL,
  auth_tag varchar(32) NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','retry','dead')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS notification_jobs_ready_idx ON quexin.notification_jobs(next_attempt_at,created_at) WHERE status IN ('pending','retry');

ALTER TABLE quexin.notification_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_jobs_enqueue ON quexin.notification_jobs FOR INSERT WITH CHECK (status='pending' AND attempts=0);
CREATE POLICY notification_jobs_recipient_read ON quexin.notification_jobs FOR SELECT USING (EXISTS(SELECT 1 FROM quexin.app_users u WHERE u.id=quexin.current_app_user() AND u.email=recipient));
-- 队列含加密令牌；普通应用只能入队，不能读取、更新或删除。独立投递角色/表所有者负责消费。
