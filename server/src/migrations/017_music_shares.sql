CREATE TABLE IF NOT EXISTS music_shares (
    id          BIGSERIAL PRIMARY KEY,
    media_id    INTEGER NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
    owner_ip    INET NOT NULL,
    token_hash  CHAR(64) NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_music_shares_token_active
ON music_shares(token_hash)
WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_music_shares_owner
ON music_shares(owner_ip, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_music_shares_one_active_per_media_owner
ON music_shares(owner_ip, media_id)
WHERE revoked_at IS NULL;
