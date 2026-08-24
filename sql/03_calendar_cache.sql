-- tarapti-backend - Migrasi kecil untuk fitur economic calendar
-- Jalankan setelah 00, 01, 02.

ALTER TABLE news_cache ADD COLUMN IF NOT EXISTS cache_key TEXT NOT NULL DEFAULT 'news';
CREATE INDEX IF NOT EXISTS idx_news_cache_key_time ON news_cache (cache_key, fetched_at);
