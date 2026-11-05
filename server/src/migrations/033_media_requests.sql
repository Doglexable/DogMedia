CREATE TABLE media_requests (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    media_type VARCHAR(10) NOT NULL CHECK (media_type IN ('music', 'video', 'photo')),
    details TEXT NOT NULL DEFAULT '',
    status VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'added', 'rejected')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX media_requests_user_created_idx ON media_requests (user_id, created_at DESC);
CREATE INDEX media_requests_status_created_idx ON media_requests (status, created_at DESC);
