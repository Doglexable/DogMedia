CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_media_assets_search_trgm
    ON media_assets USING gin (
      (lower(
        coalesce(title, '') || ' ' ||
        coalesce(artists, '') || ' ' ||
        coalesce(description, '')
      )) gin_trgm_ops
    );

CREATE INDEX IF NOT EXISTS idx_playback_events_recent_media
    ON playback_events (occurred_at DESC, media_id)
    INCLUDE (action, position, duration, client_ip);
