CREATE TABLE quexin.companion_growth_sources (
 space_id uuid NOT NULL REFERENCES quexin.couple_spaces(id) ON DELETE CASCADE,
 entity_id text NOT NULL,
 title text NOT NULL,
 contribution integer NOT NULL CHECK(contribution BETWEEN 1 AND 8),
 added_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz,
 PRIMARY KEY(space_id,entity_id)
);
ALTER TABLE quexin.companion_growth_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE quexin.companion_growth_sources FORCE ROW LEVEL SECURITY;
CREATE POLICY companion_growth_member ON quexin.companion_growth_sources FOR SELECT USING(quexin.is_space_member(space_id));
CREATE POLICY companion_growth_insert ON quexin.companion_growth_sources FOR INSERT WITH CHECK(quexin.is_space_member(space_id));
CREATE POLICY companion_growth_update ON quexin.companion_growth_sources FOR UPDATE USING(quexin.is_space_member(space_id)) WITH CHECK(quexin.is_space_member(space_id));
