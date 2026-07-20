CREATE TABLE IF NOT EXISTS playback_events (
    id          BIGSERIAL PRIMARY KEY,
    media_id    INTEGER REFERENCES media_assets(id) ON DELETE SET NULL,
    client_ip   INET NOT NULL,
    action      VARCHAR(32) NOT NULL,
    position    INTEGER NOT NULL DEFAULT 0,
    duration    INTEGER NOT NULL DEFAULT 0,
    title       VARCHAR(255),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT playback_events_action_check CHECK (action IN ('play', 'pause', 'end', 'skip'))
);

CREATE INDEX IF NOT EXISTS idx_playback_events_occurred_at ON playback_events(occurred_at);
CREATE INDEX IF NOT EXISTS idx_playback_events_media ON playback_events(media_id);
CREATE INDEX IF NOT EXISTS idx_playback_events_client_ip ON playback_events(client_ip);
CREATE INDEX IF NOT EXISTS idx_playback_events_action ON playback_events(action);
