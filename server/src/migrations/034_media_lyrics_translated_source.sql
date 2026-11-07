ALTER TABLE media_lyrics DROP CONSTRAINT IF EXISTS media_lyrics_source_check;
ALTER TABLE media_lyrics ADD CONSTRAINT media_lyrics_source_check CHECK (source IN ('uploaded', 'lrclib', 'translated'));
