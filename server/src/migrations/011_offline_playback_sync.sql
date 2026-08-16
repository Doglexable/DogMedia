ALTER TABLE playback_events
    ADD COLUMN IF NOT EXISTS client_event_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_playback_events_client_event_id
    ON playback_events(client_event_id)
    WHERE client_event_id IS NOT NULL;
