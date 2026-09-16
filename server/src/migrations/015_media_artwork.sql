ALTER TABLE media_assets
ADD COLUMN IF NOT EXISTS thumbnail_path VARCHAR(512);

ALTER TABLE media_assets
ADD COLUMN IF NOT EXISTS content_kind VARCHAR(32);

ALTER TABLE media_assets
DROP CONSTRAINT IF EXISTS media_assets_content_kind_valid;

ALTER TABLE media_assets
ADD CONSTRAINT media_assets_content_kind_valid
CHECK (content_kind IS NULL OR content_kind IN ('video_episode', 'film', 'video', 'music', 'image'));
