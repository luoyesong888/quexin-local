CREATE TABLE IF NOT EXISTS quexin.data_export_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES quexin.couple_spaces(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES quexin.app_users(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending','ready','failed')),
  object_key text,
  sha256 char(64),
  byte_size bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS data_export_jobs_user_idx ON quexin.data_export_jobs(requested_by,created_at DESC);

CREATE TABLE IF NOT EXISTS quexin.space_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES quexin.couple_spaces(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES quexin.app_users(id),
  scheduled_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  UNIQUE(space_id)
);

ALTER TABLE quexin.data_export_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE quexin.data_export_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS data_export_jobs_owner ON quexin.data_export_jobs;
CREATE POLICY data_export_jobs_owner ON quexin.data_export_jobs
  USING (requested_by=quexin.current_app_user() AND quexin.is_space_member(space_id))
  WITH CHECK (requested_by=quexin.current_app_user() AND quexin.is_space_member(space_id));

ALTER TABLE quexin.space_deletion_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE quexin.space_deletion_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS space_deletion_requests_member ON quexin.space_deletion_requests;
CREATE POLICY space_deletion_requests_member ON quexin.space_deletion_requests
  USING (quexin.is_space_member(space_id))
  WITH CHECK (requested_by=quexin.current_app_user() AND quexin.is_space_member(space_id));
