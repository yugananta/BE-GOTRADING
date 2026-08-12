-- tarapti-backend - Skema Community Chat (grup per kota/provinsi)
-- Jalankan setelah 00_backend_tables.sql dan 01_admin_schema.sql.

CREATE TABLE IF NOT EXISTS community_groups (
    id BIGSERIAL PRIMARY KEY,
    country TEXT NOT NULL,
    province TEXT NOT NULL,
    city TEXT,                      -- NULL = grup tingkat provinsi (semua kota)
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (country, province, city)
);

CREATE TABLE IF NOT EXISTS community_messages (
    id BIGSERIAL PRIMARY KEY,
    group_id BIGINT NOT NULL REFERENCES community_groups(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_community_messages_group_time
    ON community_messages (group_id, created_at);

-- Catatan desain: MVP pakai polling (client fetch pesan baru tiap
-- beberapa detik pakai parameter ?since=). Kalau nanti perlu upgrade ke
-- real-time, tinggal tambah WebSocket server di tarapti-backend
-- (library `ws`) yang broadcast INSERT baru -- tidak perlu ganti skema.
