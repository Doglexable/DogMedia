ALTER TABLE categories
ADD COLUMN IF NOT EXISTS cover_path VARCHAR(512);

ALTER TABLE media_assets
ADD COLUMN IF NOT EXISTS source_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE media_assets
DROP CONSTRAINT IF EXISTS media_assets_source_version_positive;

ALTER TABLE media_assets
ADD CONSTRAINT media_assets_source_version_positive CHECK (source_version >= 1);

CREATE TABLE IF NOT EXISTS media_encoding_variants (
    id              BIGSERIAL PRIMARY KEY,
    media_id        INTEGER NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
    source_version  INTEGER NOT NULL,
    quality         VARCHAR(8) NOT NULL,
    status          VARCHAR(16) NOT NULL DEFAULT 'queued',
    file_path       VARCHAR(512),
    mime_type       VARCHAR(100),
    bitrate         INTEGER,
    width           INTEGER,
    height          INTEGER,
    byte_size       BIGINT,
    attempts        INTEGER NOT NULL DEFAULT 0,
    last_error      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT media_encoding_variants_quality_check CHECK (quality IN ('low', 'med', 'high')),
    CONSTRAINT media_encoding_variants_status_check CHECK (status IN ('queued', 'processing', 'ready', 'failed', 'skipped')),
    CONSTRAINT media_encoding_variants_source_version_positive CHECK (source_version >= 1),
    CONSTRAINT media_encoding_variants_attempts_nonnegative CHECK (attempts >= 0),
    CONSTRAINT media_encoding_variants_media_quality_version_unique UNIQUE (media_id, quality, source_version)
);

CREATE INDEX IF NOT EXISTS idx_media_encoding_variants_media_ready
ON media_encoding_variants(media_id, source_version, quality)
WHERE status = 'ready';

CREATE INDEX IF NOT EXISTS idx_media_encoding_variants_status
ON media_encoding_variants(status, updated_at);
