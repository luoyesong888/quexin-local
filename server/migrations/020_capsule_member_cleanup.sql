CREATE FUNCTION quexin.remove_member_capsules() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=quexin,pg_temp AS $$
BEGIN DELETE FROM quexin.sealed_capsules WHERE space_id=OLD.space_id AND owner_id=OLD.user_id; RETURN OLD; END $$;
REVOKE ALL ON FUNCTION quexin.remove_member_capsules() FROM PUBLIC;
CREATE TRIGGER member_capsule_cleanup BEFORE DELETE ON quexin.space_members FOR EACH ROW EXECUTE FUNCTION quexin.remove_member_capsules();
