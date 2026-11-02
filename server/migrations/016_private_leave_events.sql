-- Do not reveal never-shared identifiers when an author leaves.
CREATE OR REPLACE FUNCTION quexin.end_membership(remove_account boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=quexin,pg_temp AS $$
DECLARE
 actor uuid := quexin.current_app_user(); sid uuid; survivor uuid; survivor_name text;
 person quexin.app_users%ROWTYPE; e record; media jsonb := '[]'; exports jsonb := '[]';
BEGIN
 SELECT * INTO person FROM quexin.app_users WHERE id=actor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'account missing'; END IF;
 SELECT space_id INTO sid FROM quexin.space_members WHERE user_id=actor;
 IF sid IS NOT NULL THEN
  PERFORM 1 FROM quexin.couple_spaces WHERE id=sid FOR UPDATE;
  SELECT user_id,display_name INTO survivor,survivor_name FROM quexin.space_members WHERE space_id=sid AND user_id<>actor;
  SELECT coalesce(jsonb_agg(to_jsonb(m)),'[]') INTO media FROM quexin.media_objects m WHERE space_id=sid AND (owner_id=actor OR survivor IS NULL);
  SELECT coalesce(jsonb_agg(to_jsonb(j)),'[]') INTO exports FROM quexin.data_export_jobs j WHERE space_id=sid;
  IF survivor IS NULL THEN
   DELETE FROM quexin.couple_spaces WHERE id=sid;
  ELSE
   FOR e IN SELECT * FROM quexin.sync_entities WHERE space_id=sid AND owner_id=actor LOOP
    UPDATE quexin.sync_entities SET payload='{}',owner_id=survivor,visibility='shared',revision=e.revision+1,deleted_at=now(),updated_at=now() WHERE space_id=sid AND entity_type=e.entity_type AND entity_id=e.entity_id;
    IF e.visibility='shared' OR EXISTS(SELECT 1 FROM quexin.sync_events WHERE space_id=sid AND entity_type=e.entity_type AND entity_id=e.entity_id AND visibility='shared') THEN
    INSERT INTO quexin.sync_events(space_id,entity_type,entity_id,revision,operation,owner_id,visibility) VALUES(sid,e.entity_type,e.entity_id,e.revision+1,'delete',survivor,'shared');
    END IF;
   END LOOP;
   DELETE FROM quexin.sync_events WHERE space_id=sid AND owner_id=actor;
   DELETE FROM quexin.media_objects WHERE space_id=sid AND owner_id=actor;
   DELETE FROM quexin.data_export_jobs WHERE space_id=sid;
   DELETE FROM quexin.space_invites WHERE space_id=sid;
   DELETE FROM quexin.space_deletion_requests WHERE space_id=sid;
   DELETE FROM quexin.companion_commands WHERE space_id=sid AND user_id=actor;
   DELETE FROM quexin.space_members WHERE space_id=sid AND user_id=actor;
   UPDATE quexin.space_members SET role='owner' WHERE space_id=sid AND user_id=survivor;
   UPDATE quexin.couple_spaces SET created_by=survivor,name='留存的空间',revision=revision+1,privacy_revision=privacy_revision+1 WHERE id=sid;
   UPDATE quexin.companion_state SET state=jsonb_set(jsonb_set(jsonb_set(state,'{profile,ownerName}',to_jsonb(survivor_name)),'{profile,partnerName}','""'),'{events}','[]') WHERE space_id=sid;
   UPDATE quexin.companion_state SET state=jsonb_set(state,'{pet,log}','["空间成员已变更，小鹊继续由留下的成员照顾。"]') WHERE space_id=sid;
  END IF;
 END IF;
 IF remove_account THEN
  DELETE FROM quexin.space_invites WHERE created_by=actor OR accepted_by=actor;
  DELETE FROM quexin.companion_commands WHERE user_id=actor;
  DELETE FROM quexin.notification_jobs WHERE recipient=person.email;
  DELETE FROM quexin.app_users WHERE id=actor;
 END IF;
 RETURN jsonb_build_object('spaceId',sid,'remainingMember',survivor IS NOT NULL,'media',media,'exports',exports,'accountDeleted',remove_account);
END $$;
