CREATE TABLE IF NOT EXISTS media_subtitles (
  id SERIAL PRIMARY KEY,
  media_id INTEGER NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  stream_index INTEGER NOT NULL,
  language VARCHAR(32),
  title VARCHAR(255),
  format VARCHAR(32) NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  has_ass_styling BOOLEAN NOT NULL DEFAULT FALSE,
  vtt_path VARCHAR(512),
  ass_path VARCHAR(512),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(media_id, stream_index)
);

CREATE INDEX IF NOT EXISTS idx_media_subtitles_media_id ON media_subtitles(media_id);
