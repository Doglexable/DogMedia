UPDATE music_share_reels
SET expires_at = LEAST(expires_at, created_at + INTERVAL '1 day'),
    updated_at = NOW()
WHERE expires_at > created_at + INTERVAL '1 day';
