-- tarapti-backend - Pengaturan integrasi yang diedit admin dari AdminPortal.tsx
-- (server MT5 default, provider berita, kredensial Telegram/FCM, dst).
-- Didesain SATU BARIS (id=1) karena cuma ada satu set pengaturan global.
-- Jalankan setelah sql/08_password_resets.sql.

CREATE TABLE IF NOT EXISTS admin_settings (
    id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1), -- singleton row
    mt5_server TEXT,
    mt5_login TEXT,
    mt5_password TEXT,      -- [CATATAN] sebaiknya pindah ke secret manager, bukan tabel biasa, sebelum go-live
    mt5_port TEXT,
    mt5_status TEXT DEFAULT 'disconnected',
    news_provider TEXT,
    news_rss_url TEXT,
    news_api_key TEXT,
    telegram_bot_token TEXT,
    telegram_chat_id TEXT,
    fcm_server_key TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO admin_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
