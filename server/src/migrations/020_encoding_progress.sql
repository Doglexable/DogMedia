ALTER TABLE media_encoding_variants
ADD COLUMN IF NOT EXISTS progress_percent SMALLINT NOT NULL DEFAULT 0;

ALTER TABLE media_encoding_variants
DROP CONSTRAINT IF EXISTS media_encoding_variants_progress_percent_range;

ALTER TABLE media_encoding_variants
ADD CONSTRAINT media_encoding_variants_progress_percent_range
CHECK (progress_percent BETWEEN 0 AND 100);

UPDATE media_encoding_variants
SET progress_percent = 100
WHERE status IN ('ready', 'skipped');
