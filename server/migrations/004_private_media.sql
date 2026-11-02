ALTER TABLE quexin.media_objects
  ADD COLUMN IF NOT EXISTS original_filename text NOT NULL DEFAULT 'upload',
  ADD COLUMN IF NOT EXISTS thumbnail_key text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS output_content_type text,
  ADD COLUMN IF NOT EXISTS stored_byte_size bigint,
  ADD COLUMN IF NOT EXISTS width integer,
  ADD COLUMN IF NOT EXISTS height integer,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='media_objects_status_check'
      AND conrelid='quexin.media_objects'::regclass
  ) THEN
    ALTER TABLE quexin.media_objects
      ADD CONSTRAINT media_objects_status_check CHECK (status IN ('pending','ready','failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS media_objects_space_status_idx
  ON quexin.media_objects(space_id,status,created_at DESC);
