CREATE TABLE quexin.companion_state (
  space_id uuid PRIMARY KEY REFERENCES quexin.couple_spaces(id) ON DELETE CASCADE,
  state jsonb NOT NULL
);
CREATE TABLE quexin.companion_commands (
  space_id uuid NOT NULL REFERENCES quexin.couple_spaces(id) ON DELETE CASCADE,
  command_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES quexin.app_users(id),
  PRIMARY KEY(space_id,command_id)
);
ALTER TABLE quexin.companion_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE quexin.companion_state FORCE ROW LEVEL SECURITY;
CREATE POLICY companion_member ON quexin.companion_state USING(quexin.is_space_member(space_id)) WITH CHECK(quexin.is_space_member(space_id));
ALTER TABLE quexin.companion_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE quexin.companion_commands FORCE ROW LEVEL SECURITY;
CREATE POLICY companion_command_member ON quexin.companion_commands USING(quexin.is_space_member(space_id)) WITH CHECK(quexin.is_space_member(space_id) AND user_id=quexin.current_app_user());
