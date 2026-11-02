CREATE FUNCTION quexin.delete_owned_space(target uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=quexin,pg_temp AS $$
DECLARE media jsonb; exports jsonb;
BEGIN
 PERFORM 1 FROM quexin.couple_spaces WHERE id=target FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM quexin.space_members WHERE space_id=target AND user_id=quexin.current_app_user() AND role='owner') THEN
  RAISE EXCEPTION 'space owner required';
 END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(m)),'[]') INTO media FROM quexin.media_objects m WHERE space_id=target;
 SELECT coalesce(jsonb_agg(to_jsonb(j)),'[]') INTO exports FROM quexin.data_export_jobs j WHERE space_id=target;
 DELETE FROM quexin.couple_spaces WHERE id=target;
 RETURN jsonb_build_object('media',media,'exports',exports);
END $$;
REVOKE ALL ON FUNCTION quexin.delete_owned_space(uuid) FROM PUBLIC;
