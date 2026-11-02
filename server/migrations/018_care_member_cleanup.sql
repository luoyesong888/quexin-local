CREATE FUNCTION quexin.remove_member_care_signal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=quexin,pg_temp AS $$
BEGIN DELETE FROM quexin.care_signals WHERE space_id=OLD.space_id AND user_id=OLD.user_id; RETURN OLD; END $$;
REVOKE ALL ON FUNCTION quexin.remove_member_care_signal() FROM PUBLIC;
CREATE TRIGGER member_care_cleanup BEFORE DELETE ON quexin.space_members FOR EACH ROW EXECUTE FUNCTION quexin.remove_member_care_signal();
