-- tarapti-backend - Skema inti social media (feed, follow, chat, notifikasi)
-- Jalankan setelah sql/05_user_profile_fields.sql.
--
-- KENAPA INI ADA: sebelumnya semua fitur social media (Network.tsx,
-- Explore.tsx, Messages.tsx, Notifications.tsx, PostCard.tsx, dst di
-- frontend) jalan di atas backend BAWAAN frontend sendiri (server.ts +
-- Supabase tabel 'Post'/'Connection'/dst, dengan fallback ke file JSON
-- lokal). Itu terpisah dari tarapti-backend dan datanya tidak nyambung ke
-- fitur IB/admin/MT5 yang sudah dibangun di sini. Skema di bawah
-- memindahkan seluruh domain itu ke tarapti-backend supaya SATU sumber
-- data. Desainnya dinormalisasi (junction table untuk like/bookmark/
-- repost/follow), bukan array JSON seperti versi lama -- lebih aman untuk
-- concurrent write dan query performa di skala besar.

-- ============================================================
-- POSTS (feed)
-- ============================================================

CREATE TABLE IF NOT EXISTS posts (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT,
    content TEXT NOT NULL,
    images TEXT[] DEFAULT '{}',
    video_url TEXT,
    tags TEXT[] DEFAULT '{}',
    chart JSONB,                         -- { pair, timeframe, status, points: [...] }
    group_id BIGINT REFERENCES community_groups(id) ON DELETE SET NULL,
    original_post_id BIGINT REFERENCES posts(id) ON DELETE SET NULL, -- diisi kalau ini repost
    is_official BOOLEAN NOT NULL DEFAULT FALSE,
    is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
    market_bias TEXT CHECK (market_bias IN ('Bullish', 'Bearish')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_posts_feed ON posts (is_pinned DESC, is_official DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_user ON posts (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_group ON posts (group_id, created_at DESC);

CREATE TABLE IF NOT EXISTS post_likes (
    post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS post_bookmarks (
    post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS post_reposts (
    post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS comments (
    id BIGSERIAL PRIMARY KEY,
    post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comments_post ON comments (post_id, created_at);

-- ============================================================
-- FOLLOW & CONNECTION (dua konsep beda di frontend: follow satu arah
-- seperti Twitter/X, connection dua arah butuh approval seperti LinkedIn)
-- ============================================================

CREATE TABLE IF NOT EXISTS follows (
    follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    following_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (follower_id, following_id),
    CHECK (follower_id <> following_id)
);

CREATE INDEX IF NOT EXISTS idx_follows_following ON follows (following_id);

CREATE TABLE IF NOT EXISTS connections (
    requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (requester_id, receiver_id),
    CHECK (requester_id <> receiver_id)
);

CREATE INDEX IF NOT EXISTS idx_connections_receiver ON connections (receiver_id, status);

-- ============================================================
-- MESSAGES (chat 1-on-1)
-- ============================================================

CREATE TABLE IF NOT EXISTS messages (
    id BIGSERIAL PRIMARY KEY,
    sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT,
    content TEXT,
    image TEXT,
    file_url TEXT,
    file_name TEXT,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    is_delivered BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages (LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id), created_at);
CREATE INDEX IF NOT EXISTS idx_messages_receiver_unread ON messages (receiver_id, is_read);

CREATE TABLE IF NOT EXISTS message_reactions (
    message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji TEXT NOT NULL,
    PRIMARY KEY (message_id, user_id, emoji)
);

-- ============================================================
-- NOTIFICATIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS notifications (
    id BIGSERIAL PRIMARY KEY,
    to_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    from_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    type TEXT NOT NULL,   -- 'like' | 'comment' | 'reply' | 'follow' | 'mention' | 'message' |
                           -- 'market_pulse' | 'friend_request' | 'friend_accepted' | 'repost' |
                           -- 'profit_target_daily' | 'profit_target_weekly' | 'drawdown_daily' |
                           -- 'drawdown_weekly' | 'high_news'
    message TEXT NOT NULL,
    asset_class TEXT,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_to_user ON notifications (to_user_id, is_read, created_at DESC);
