CREATE TABLE quexin.care_signals (
 space_id uuid NOT NULL REFERENCES quexin.couple_spaces(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES quexin.app_users(id) ON DELETE CASCADE,
 need text NOT NULL CHECK(need IN ('想安静','想聊聊','想被听见','一起想办法')),
 message text NOT NULL DEFAULT '' CHECK(char_length(message)<=280),
 expires_at timestamptz NOT NULL,
 version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz,
 PRIMARY KEY(space_id,user_id)
);
ALTER TABLE quexin.care_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE quexin.care_signals FORCE ROW LEVEL SECURITY;
CREATE POLICY care_signals_select ON quexin.care_signals FOR SELECT USING(quexin.is_space_member(space_id));
CREATE POLICY care_signals_insert ON quexin.care_signals FOR INSERT WITH CHECK(quexin.is_space_member(space_id) AND user_id=quexin.current_app_user());
CREATE POLICY care_signals_update ON quexin.care_signals FOR UPDATE USING(quexin.is_space_member(space_id) AND user_id=quexin.current_app_user()) WITH CHECK(user_id=quexin.current_app_user());
CREATE POLICY care_signals_delete ON quexin.care_signals FOR DELETE USING(quexin.is_space_member(space_id) AND user_id=quexin.current_app_user());
