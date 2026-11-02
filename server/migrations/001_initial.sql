CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS quexin;

CREATE TABLE IF NOT EXISTS quexin.app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 30),
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_users_email_lowercase CHECK (email = lower(email))
);
CREATE UNIQUE INDEX IF NOT EXISTS app_users_email_unique ON quexin.app_users (lower(email));

CREATE TABLE IF NOT EXISTS quexin.auth_sessions (
  token_hash char(64) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES quexin.app_users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON quexin.auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS auth_sessions_expiry_idx ON quexin.auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS quexin.couple_spaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  created_by uuid NOT NULL REFERENCES quexin.app_users(id),
  revision bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS quexin.space_members (
  space_id uuid NOT NULL REFERENCES quexin.couple_spaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES quexin.app_users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','partner')),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 30),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(space_id,user_id),
  UNIQUE(user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_owner_per_space ON quexin.space_members(space_id) WHERE role='owner';

CREATE TABLE IF NOT EXISTS quexin.space_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash char(64) UNIQUE NOT NULL,
  code_preview varchar(2) NOT NULL,
  space_id uuid NOT NULL REFERENCES quexin.couple_spaces(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending','accepted','revoked','expired')),
  created_by uuid NOT NULL REFERENCES quexin.app_users(id),
  accepted_by uuid REFERENCES quexin.app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS space_invites_space_idx ON quexin.space_invites(space_id,status);

CREATE TABLE IF NOT EXISTS quexin.sync_entities (
  space_id uuid NOT NULL REFERENCES quexin.couple_spaces(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('record','plan','journal','pet_action','space_settings')),
  entity_id uuid NOT NULL,
  owner_id uuid NOT NULL REFERENCES quexin.app_users(id),
  visibility text NOT NULL CHECK (visibility IN ('private','shared','pending_partner','sealed_secret')),
  revision integer NOT NULL CHECK (revision > 0),
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  PRIMARY KEY(space_id,entity_type,entity_id)
);
CREATE INDEX IF NOT EXISTS sync_entities_owner_idx ON quexin.sync_entities(owner_id,visibility);

CREATE TABLE IF NOT EXISTS quexin.sync_events (
  sequence bigserial PRIMARY KEY,
  space_id uuid NOT NULL REFERENCES quexin.couple_spaces(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  revision integer NOT NULL,
  operation text NOT NULL CHECK (operation IN ('create','update','delete','append')),
  owner_id uuid NOT NULL REFERENCES quexin.app_users(id),
  visibility text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sync_events_cursor_idx ON quexin.sync_events(space_id,sequence);

CREATE TABLE IF NOT EXISTS quexin.processed_commands (
  space_id uuid NOT NULL REFERENCES quexin.couple_spaces(id) ON DELETE CASCADE,
  command_id uuid NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(space_id,command_id)
);

CREATE TABLE IF NOT EXISTS quexin.media_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES quexin.couple_spaces(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES quexin.app_users(id),
  visibility text NOT NULL CHECK (visibility IN ('private','shared')),
  object_key text UNIQUE NOT NULL,
  content_type text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size >= 0),
  sha256 char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE OR REPLACE FUNCTION quexin.current_app_user() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id',true),'')::uuid $$;

CREATE OR REPLACE FUNCTION quexin.is_space_member(target_space uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=quexin,pg_temp AS $$
  SELECT EXISTS(SELECT 1 FROM quexin.space_members WHERE space_id=target_space AND user_id=quexin.current_app_user())
$$;

CREATE OR REPLACE FUNCTION quexin.space_member_count(target_space uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=quexin,pg_temp AS $$
  SELECT count(*)::integer FROM quexin.space_members WHERE space_id=target_space
$$;

ALTER TABLE quexin.couple_spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE quexin.couple_spaces FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS couple_spaces_member ON quexin.couple_spaces;
CREATE POLICY couple_spaces_select ON quexin.couple_spaces FOR SELECT
  USING (quexin.is_space_member(id) OR created_by=quexin.current_app_user());
CREATE POLICY couple_spaces_insert ON quexin.couple_spaces FOR INSERT
  WITH CHECK (created_by=quexin.current_app_user());
CREATE POLICY couple_spaces_update ON quexin.couple_spaces FOR UPDATE
  USING (quexin.is_space_member(id)) WITH CHECK (quexin.is_space_member(id));
CREATE POLICY couple_spaces_delete ON quexin.couple_spaces FOR DELETE
  USING (created_by=quexin.current_app_user());

ALTER TABLE quexin.space_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS space_members_visible ON quexin.space_members;
CREATE POLICY space_members_visible ON quexin.space_members
  USING (quexin.is_space_member(space_id) OR user_id=quexin.current_app_user())
  WITH CHECK (user_id=quexin.current_app_user() AND quexin.space_member_count(space_id)<2);

ALTER TABLE quexin.sync_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE quexin.sync_entities FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sync_entities_member ON quexin.sync_entities;
CREATE POLICY sync_entities_member ON quexin.sync_entities
  USING (quexin.is_space_member(space_id) AND (visibility<>'private' OR owner_id=quexin.current_app_user()))
  WITH CHECK (quexin.is_space_member(space_id) AND (visibility<>'private' OR owner_id=quexin.current_app_user()));

ALTER TABLE quexin.sync_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE quexin.sync_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sync_events_member ON quexin.sync_events;
CREATE POLICY sync_events_member ON quexin.sync_events
  USING (quexin.is_space_member(space_id) AND (visibility<>'private' OR owner_id=quexin.current_app_user()))
  WITH CHECK (quexin.is_space_member(space_id) AND owner_id=quexin.current_app_user());

ALTER TABLE quexin.processed_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE quexin.processed_commands FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS processed_commands_member ON quexin.processed_commands;
CREATE POLICY processed_commands_member ON quexin.processed_commands
  USING (quexin.is_space_member(space_id))
  WITH CHECK (quexin.is_space_member(space_id));

ALTER TABLE quexin.media_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE quexin.media_objects FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS media_objects_member ON quexin.media_objects;
CREATE POLICY media_objects_member ON quexin.media_objects
  USING (quexin.is_space_member(space_id) AND (visibility<>'private' OR owner_id=quexin.current_app_user()))
  WITH CHECK (quexin.is_space_member(space_id) AND owner_id=quexin.current_app_user());

