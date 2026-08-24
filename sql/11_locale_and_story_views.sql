-- tarapti-backend - Preferensi bahasa user + pelacak view story
-- Jalankan setelah sql/10_stories_schema.sql.
--
-- KENAPA: frontend AI Studio punya 2 fitur yang belum ada tempat
-- penyimpanannya di sini -- (1) preferensi bahasa/locale user (App.tsx
-- inisialisasi i18n dari profil), dan (2) daftar siapa saja yang sudah
-- melihat sebuah story (StoriesList.tsx tampilkan "dilihat oleh X orang").

ALTER TABLE users ADD COLUMN IF NOT EXISTS locale TEXT DEFAULT 'id';

CREATE TABLE IF NOT EXISTS story_views (
    story_id BIGINT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    viewer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    viewed_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (story_id, viewer_id)
);

CREATE INDEX IF NOT EXISTS idx_story_views_story ON story_views (story_id);
