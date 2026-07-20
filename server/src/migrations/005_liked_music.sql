CREATE TABLE IF NOT EXISTS liked_music (
    client_ip INET NOT NULL,
    media_id  INTEGER NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
    liked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (client_ip, media_id)
);

CREATE INDEX IF NOT EXISTS idx_liked_music_client_liked
ON liked_music(client_ip, liked_at DESC);

CREATE TABLE IF NOT EXISTS liked_music_shares (
    client_ip  INET PRIMARY KEY,
    token_hash CHAR(64) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
