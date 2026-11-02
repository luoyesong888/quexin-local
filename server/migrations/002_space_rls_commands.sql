DROP POLICY IF EXISTS couple_spaces_member ON quexin.couple_spaces;
DROP POLICY IF EXISTS couple_spaces_select ON quexin.couple_spaces;
DROP POLICY IF EXISTS couple_spaces_insert ON quexin.couple_spaces;
DROP POLICY IF EXISTS couple_spaces_update ON quexin.couple_spaces;
DROP POLICY IF EXISTS couple_spaces_delete ON quexin.couple_spaces;

CREATE POLICY couple_spaces_select ON quexin.couple_spaces FOR SELECT
  USING (quexin.is_space_member(id) OR created_by=quexin.current_app_user());

CREATE POLICY couple_spaces_insert ON quexin.couple_spaces FOR INSERT
  WITH CHECK (created_by=quexin.current_app_user());

CREATE POLICY couple_spaces_update ON quexin.couple_spaces FOR UPDATE
  USING (quexin.is_space_member(id))
  WITH CHECK (quexin.is_space_member(id));

CREATE POLICY couple_spaces_delete ON quexin.couple_spaces FOR DELETE
  USING (created_by=quexin.current_app_user());
