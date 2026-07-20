CREATE TABLE IF NOT EXISTS media_lyrics (
    media_id   INTEGER PRIMARY KEY REFERENCES media_assets(id) ON DELETE CASCADE,
    language   VARCHAR(32),
    segments   JSONB NOT NULL CHECK (jsonb_typeof(segments) = 'array'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

