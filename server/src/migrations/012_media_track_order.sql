ALTER TABLE media_assets
ADD COLUMN IF NOT EXISTS track_order INTEGER;

ALTER TABLE media_assets
DROP CONSTRAINT IF EXISTS media_assets_track_order_positive;

ALTER TABLE media_assets
ADD CONSTRAINT media_assets_track_order_positive
CHECK (track_order IS NULL OR track_order >= 1);

CREATE INDEX IF NOT EXISTS idx_media_assets_category_track_order
ON media_assets(category_id, track_order, title, id);
