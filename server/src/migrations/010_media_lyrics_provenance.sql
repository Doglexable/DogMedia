ALTER TABLE media_lyrics
    ADD COLUMN source VARCHAR(16) NOT NULL DEFAULT 'uploaded',
    ADD COLUMN lookup_title TEXT,
    ADD COLUMN lookup_artists TEXT,
    ADD CONSTRAINT media_lyrics_source_check CHECK (source IN ('uploaded', 'lyrica'));

