ALTER TABLE media_assets
ADD COLUMN IF NOT EXISTS offline_allowed BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_media_assets_offline_allowed
ON media_assets (category_id, id)
WHERE offline_allowed = TRUE;
