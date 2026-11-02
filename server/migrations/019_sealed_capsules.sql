CREATE TABLE quexin.sealed_capsules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 space_id uuid NOT NULL REFERENCES quexin.couple_spaces(id) ON DELETE CASCADE,
 owner_id uuid NOT NULL REFERENCES quexin.app_users(id) ON DELETE CASCADE,
 title text NOT NULL CHECK(char_length(title) BETWEEN 1 AND 80),
 ciphertext text NOT NULL,
 iv text NOT NULL,
 auth_tag text NOT NULL,
 unlock_at timestamptz NOT NULL,
 visibility text NOT NULL CHECK(visibility IN ('private','shared')),
 created_at timestamptz NOT NULL DEFAULT now(),
 opened_at timestamptz,
 deleted_at timestamptz
);
CREATE INDEX sealed_capsules_space_idx ON quexin.sealed_capsules(space_id,unlock_at) WHERE deleted_at IS NULL;
ALTER TABLE quexin.sealed_capsules ENABLE ROW LEVEL SECURITY;
ALTER TABLE quexin.sealed_capsules FORCE ROW LEVEL SECURITY;
CREATE POLICY sealed_capsules_select ON quexin.sealed_capsules FOR SELECT USING(quexin.is_space_member(space_id) AND (visibility='shared' OR owner_id=quexin.current_app_user()));
CREATE POLICY sealed_capsules_insert ON quexin.sealed_capsules FOR INSERT WITH CHECK(quexin.is_space_member(space_id) AND owner_id=quexin.current_app_user());
CREATE POLICY sealed_capsules_update ON quexin.sealed_capsules FOR UPDATE USING(quexin.is_space_member(space_id) AND owner_id=quexin.current_app_user()) WITH CHECK(owner_id=quexin.current_app_user());
