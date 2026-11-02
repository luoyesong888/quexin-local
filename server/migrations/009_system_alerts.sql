CREATE TABLE IF NOT EXISTS quexin.system_alerts (
  id bigserial PRIMARY KEY,
  severity text NOT NULL CHECK (severity IN ('warning','critical')),
  source text NOT NULL,
  code text NOT NULL,
  message text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
ALTER TABLE quexin.system_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS system_alerts_authenticated_read ON quexin.system_alerts;
CREATE POLICY system_alerts_authenticated_read ON quexin.system_alerts FOR SELECT USING (quexin.current_app_user() IS NOT NULL);
CREATE INDEX IF NOT EXISTS system_alerts_open_idx ON quexin.system_alerts(created_at DESC) WHERE resolved_at IS NULL;
