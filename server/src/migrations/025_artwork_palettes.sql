CREATE TABLE IF NOT EXISTS artwork_palettes (
    artwork_path     VARCHAR(512) PRIMARY KEY,
    colors           JSONB NOT NULL,
    algorithm_version SMALLINT NOT NULL,
    file_fingerprint VARCHAR(128) NOT NULL,
    computed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT artwork_palettes_colors_array CHECK (jsonb_typeof(colors) = 'array'),
    CONSTRAINT artwork_palettes_algorithm_positive CHECK (algorithm_version > 0)
);
