-- 13_mt5_persistence.sql
-- MT5 ACCOUNT PERSISTENCE & AUTO-RECONNECT
-- ---------------------------------------------------------------
-- Menambahkan kolom agar credential + status koneksi akun MT5 tetap
-- tersimpan di database (Supabase) dan tidak hilang saat backend
-- restart / deploy / MT5 Gateway restart.
--
-- Semua statement idempotent (IF NOT EXISTS), aman dijalankan berulang.
-- Password disimpan TERENKRIPSI (password_enc), tidak pernah plaintext,
-- dan TIDAK pernah dikembalikan ke Frontend.

ALTER TABLE user_mt5_accounts ADD COLUMN IF NOT EXISTS platform TEXT;
ALTER TABLE user_mt5_accounts ADD COLUMN IF NOT EXISTS server TEXT;
ALTER TABLE user_mt5_accounts ADD COLUMN IF NOT EXISTS broker TEXT;
ALTER TABLE user_mt5_accounts ADD COLUMN IF NOT EXISTS password_enc TEXT;

-- Apakah credential tersimpan dan bisa dipakai auto-reconnect
ALTER TABLE user_mt5_accounts ADD COLUMN IF NOT EXISTS credential_saved BOOLEAN DEFAULT FALSE;

-- Status koneksi sebenarnya (sesuai requirement):
--   'connected'     -> terhubung ke MT5 Gateway + MT5
--   'reconnecting'  -> koneksi putus, sistem sedang auto-reconnect
--   'disconnected'  -> belum/koneksi sengaja dilepas, butuh connect manual
--   'error'         -> credential invalid/expired / gagal reconnect berkali-kali
ALTER TABLE user_mt5_accounts ADD COLUMN IF NOT EXISTS conn_status TEXT DEFAULT 'disconnected';

ALTER TABLE user_mt5_accounts ADD COLUMN IF NOT EXISTS last_connected_at TIMESTAMPTZ;
ALTER TABLE user_mt5_accounts ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE user_mt5_accounts ADD COLUMN IF NOT EXISTS reconnect_attempts INT DEFAULT 0;
ALTER TABLE user_mt5_accounts ADD COLUMN IF NOT EXISTS next_reconnect_at TIMESTAMPTZ;
ALTER TABLE user_mt5_accounts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Index untuk query monitor auto-reconnect
CREATE INDEX IF NOT EXISTS idx_user_mt5_accounts_creds
  ON user_mt5_accounts (credential_saved);
