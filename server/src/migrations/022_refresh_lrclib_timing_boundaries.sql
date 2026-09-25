-- Re-fetch persisted LRCLIB rows lazily so empty LRC timestamps can be
-- reinterpreted as vocal timing boundaries by the updated parser.
UPDATE media_lyrics
SET updated_at = TIMESTAMPTZ 'epoch'
WHERE source = 'lrclib';
