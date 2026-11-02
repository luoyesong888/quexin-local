ALTER TABLE quexin.app_users
  ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

ALTER TABLE quexin.auth_sessions
  ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS user_agent text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS ip_hash char(64),
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS auth_sessions_id_unique ON quexin.auth_sessions(id);
CREATE INDEX IF NOT EXISTS auth_sessions_active_user_idx ON quexin.auth_sessions(user_id,expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS quexin.account_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES quexin.app_users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('verify_email','reset_password')),
  token_hash char(64) UNIQUE NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS account_tokens_active_idx ON quexin.account_tokens(user_id,purpose,expires_at) WHERE used_at IS NULL;
