CREATE TABLE IF NOT EXISTS quexin.maintenance_runs (
  id bigserial PRIMARY KEY,
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('success','partial','failed')),
  expired_exports integer NOT NULL DEFAULT 0,
  deleted_spaces integer NOT NULL DEFAULT 0,
  removed_media integer NOT NULL DEFAULT 0,
  expired_sessions integer NOT NULL DEFAULT 0,
  expired_tokens integer NOT NULL DEFAULT 0,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE quexin.maintenance_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS maintenance_runs_authenticated_read ON quexin.maintenance_runs;
CREATE POLICY maintenance_runs_authenticated_read ON quexin.maintenance_runs FOR SELECT
  USING (quexin.current_app_user() IS NOT NULL);

CREATE INDEX IF NOT EXISTS maintenance_runs_completed_idx ON quexin.maintenance_runs(completed_at DESC);
