-- 浏览器本地资料在云同步前已经有稳定字符串 ID；服务端不应强迫它们重写为 UUID。
ALTER TABLE quexin.sync_entities
  ALTER COLUMN entity_id TYPE text USING entity_id::text;

ALTER TABLE quexin.sync_events
  ALTER COLUMN entity_id TYPE text USING entity_id::text;
