-- Resolve every stored owner IP before removing the IP columns. Account-era
-- IPv6 identities map back to their user ID; older IP-only data is preserved
-- under a disabled archive account so it is never assigned to the wrong user.
CREATE TEMP TABLE ip_owner_map (
    ip INET PRIMARY KEY,
    user_id INTEGER,
    archive_username VARCHAR(40)
) ON COMMIT DROP;

INSERT INTO ip_owner_map (ip)
SELECT client_ip FROM playback_events
UNION SELECT client_ip FROM liked_music
UNION SELECT client_ip FROM liked_music_shares
UNION SELECT client_ip FROM wrapped_access_locks
UNION SELECT owner_ip FROM music_shares
UNION SELECT owner_ip FROM music_share_reels;

UPDATE ip_owner_map AS m
SET user_id = u.id
FROM users AS u
WHERE m.ip = ('fd50::' || to_hex(u.id / 65536) || ':' || to_hex(u.id % 65536))::inet;

UPDATE ip_owner_map
SET archive_username = 'legacy_' || replace(gen_random_uuid()::text, '-', '')
WHERE user_id IS NULL;

INSERT INTO users (username, password_hash, access_tier)
SELECT archive_username, 'disabled', 0
FROM ip_owner_map
WHERE user_id IS NULL;

UPDATE ip_owner_map AS m
SET user_id = u.id
FROM users AS u
WHERE m.archive_username = u.username AND m.user_id IS NULL;

ALTER TABLE playback_events ADD COLUMN user_id INTEGER;
UPDATE playback_events AS e SET user_id = m.user_id FROM ip_owner_map AS m WHERE e.client_ip = m.ip;
ALTER TABLE playback_events ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE playback_events ADD CONSTRAINT playback_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);
DROP INDEX IF EXISTS idx_playback_events_recent_media;
ALTER TABLE playback_events DROP COLUMN client_ip;
CREATE INDEX idx_playback_events_user_id ON playback_events(user_id);
CREATE INDEX idx_playback_events_recent_media ON playback_events (occurred_at DESC, media_id)
    INCLUDE (action, position, duration, user_id);

ALTER TABLE liked_music ADD COLUMN user_id INTEGER;
UPDATE liked_music AS l SET user_id = m.user_id FROM ip_owner_map AS m WHERE l.client_ip = m.ip;
ALTER TABLE liked_music ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE liked_music DROP CONSTRAINT liked_music_pkey;
ALTER TABLE liked_music DROP COLUMN client_ip;
ALTER TABLE liked_music ADD CONSTRAINT liked_music_pkey PRIMARY KEY (user_id, media_id);
ALTER TABLE liked_music ADD CONSTRAINT liked_music_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);
CREATE INDEX idx_liked_music_user_liked ON liked_music(user_id, liked_at DESC);

ALTER TABLE liked_music_shares ADD COLUMN user_id INTEGER;
UPDATE liked_music_shares AS s SET user_id = m.user_id FROM ip_owner_map AS m WHERE s.client_ip = m.ip;
ALTER TABLE liked_music_shares ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE liked_music_shares DROP CONSTRAINT liked_music_shares_pkey;
ALTER TABLE liked_music_shares DROP COLUMN client_ip;
ALTER TABLE liked_music_shares ADD CONSTRAINT liked_music_shares_pkey PRIMARY KEY (user_id);
ALTER TABLE liked_music_shares ADD CONSTRAINT liked_music_shares_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);

ALTER TABLE wrapped_access_locks ADD COLUMN user_id INTEGER;
UPDATE wrapped_access_locks AS l SET user_id = m.user_id FROM ip_owner_map AS m WHERE l.client_ip = m.ip;
ALTER TABLE wrapped_access_locks ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE wrapped_access_locks DROP CONSTRAINT wrapped_access_locks_pkey;
ALTER TABLE wrapped_access_locks DROP COLUMN client_ip;
ALTER TABLE wrapped_access_locks ADD CONSTRAINT wrapped_access_locks_pkey PRIMARY KEY (user_id);
ALTER TABLE wrapped_access_locks ADD CONSTRAINT wrapped_access_locks_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);

ALTER TABLE music_shares ADD COLUMN user_id INTEGER;
UPDATE music_shares AS s SET user_id = m.user_id FROM ip_owner_map AS m WHERE s.owner_ip = m.ip;
ALTER TABLE music_shares ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE music_shares DROP COLUMN owner_ip;
ALTER TABLE music_shares ADD CONSTRAINT music_shares_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);
CREATE INDEX idx_music_shares_owner ON music_shares(user_id, created_at DESC);
CREATE UNIQUE INDEX idx_music_shares_one_active_per_media_owner ON music_shares(user_id, media_id)
    WHERE revoked_at IS NULL;

ALTER TABLE music_share_reels ADD COLUMN user_id INTEGER;
UPDATE music_share_reels AS r SET user_id = m.user_id FROM ip_owner_map AS m WHERE r.owner_ip = m.ip;
ALTER TABLE music_share_reels ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE music_share_reels DROP COLUMN owner_ip;
ALTER TABLE music_share_reels ADD CONSTRAINT music_share_reels_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);
CREATE UNIQUE INDEX idx_music_share_reels_one_active_owner ON music_share_reels(user_id)
    WHERE revoked_at IS NULL;
