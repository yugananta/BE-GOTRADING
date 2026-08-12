-- tarapti-backend - Fitur Stories (cerita 24 jam, mirip Instagram Stories)
-- Jalankan setelah sql/09_admin_settings.sql.

CREATE TABLE IF NOT EXISTS stories (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours')
);

CREATE INDEX IF NOT EXISTS idx_stories_active ON stories (expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_stories_user ON stories (user_id, created_at DESC);
