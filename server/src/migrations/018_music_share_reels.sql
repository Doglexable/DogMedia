CREATE TABLE IF NOT EXISTS music_share_reels (
    id               BIGSERIAL PRIMARY KEY,
    owner_ip         INET NOT NULL,
    token_hash       CHAR(64) NOT NULL UNIQUE,
    status           VARCHAR(16) NOT NULL DEFAULT 'queued',
    progress         SMALLINT NOT NULL DEFAULT 0,
    output_path      VARCHAR(512),
    duration_seconds INTEGER,
    expires_at       TIMESTAMPTZ NOT NULL,
    revoked_at       TIMESTAMPTZ,
    attempts         INTEGER NOT NULL DEFAULT 0,
    last_error       TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT music_share_reels_status_check
      CHECK (status IN ('queued', 'processing', 'ready', 'failed')),
    CONSTRAINT music_share_reels_progress_check CHECK (progress BETWEEN 0 AND 100),
    CONSTRAINT music_share_reels_attempts_check CHECK (attempts >= 0)
);

CREATE TABLE IF NOT EXISTS music_share_reel_items (
    reel_id          BIGINT NOT NULL REFERENCES music_share_reels(id) ON DELETE CASCADE,
    position         SMALLINT NOT NULL CHECK (position BETWEEN 1 AND 10),
    media_id         INTEGER NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
    source_version   INTEGER NOT NULL,
    clip_start       NUMERIC(10, 3) NOT NULL DEFAULT 0 CHECK (clip_start >= 0),
    title            VARCHAR(255) NOT NULL,
    artists          VARCHAR(512),
    PRIMARY KEY (reel_id, position),
    UNIQUE (reel_id, media_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_music_share_reels_one_active_owner
ON music_share_reels(owner_ip)
WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_music_share_reels_token_active
ON music_share_reels(token_hash)
WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_music_share_reels_status
ON music_share_reels(status, updated_at)
WHERE revoked_at IS NULL;
