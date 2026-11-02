CREATE TABLE quexin.file_cleanup_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 kind text NOT NULL CHECK(kind IN ('media','export')),
 object_key text NOT NULL,
 thumbnail_key text,
 attempts integer NOT NULL DEFAULT 0,
 last_error text,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE quexin.file_cleanup_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE quexin.file_cleanup_jobs FORCE ROW LEVEL SECURITY;
-- No application policy: only the local maintenance connection may consume it.
CREATE FUNCTION quexin.enqueue_file_cleanup() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=quexin,pg_temp AS $$
BEGIN
 IF TG_TABLE_NAME='media_objects' THEN
  IF TG_OP='DELETE' OR (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL) THEN
   IF OLD.object_key IS NOT NULL AND OLD.object_key NOT LIKE 'pending/%' THEN
    INSERT INTO quexin.file_cleanup_jobs(kind,object_key,thumbnail_key) VALUES('media',OLD.object_key,OLD.thumbnail_key);
   END IF;
  END IF;
 ELSIF OLD.object_key IS NOT NULL THEN
  INSERT INTO quexin.file_cleanup_jobs(kind,object_key) VALUES('export',OLD.object_key);
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION quexin.enqueue_file_cleanup() FROM PUBLIC;
CREATE TRIGGER media_cleanup_outbox AFTER DELETE OR UPDATE OF deleted_at ON quexin.media_objects FOR EACH ROW EXECUTE FUNCTION quexin.enqueue_file_cleanup();
CREATE TRIGGER export_cleanup_outbox AFTER DELETE ON quexin.data_export_jobs FOR EACH ROW EXECUTE FUNCTION quexin.enqueue_file_cleanup();
