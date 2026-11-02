ALTER TABLE quexin.media_objects
  ADD COLUMN IF NOT EXISTS entity_type text,
  ADD COLUMN IF NOT EXISTS entity_id text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='media_objects_entity_type_check'
      AND conrelid='quexin.media_objects'::regclass
  ) THEN
    ALTER TABLE quexin.media_objects
      ADD CONSTRAINT media_objects_entity_type_check CHECK (entity_type IS NULL OR entity_type IN ('record','journal'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS media_objects_entity_idx
  ON quexin.media_objects(space_id,entity_type,entity_id)
  WHERE deleted_at IS NULL;
