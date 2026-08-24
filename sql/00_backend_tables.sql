-- Tabel yang dibutuhkan tarapti-backend. Jalankan di SQL Editor Supabase.

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    country TEXT,
    province TEXT,
    city TEXT,
    whatsapp TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_mt5_accounts (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    akun_id INT NOT NULL,
    status TEXT DEFAULT 'connected',
    -- Snapshot terakhir data MT5 (account + trades) hasil sync/refresh
    -- dari gateway. Dipakai supaya history tetap tersedia per-akun walau gateway
    -- sedang tidak bisa dihubungi atau sedang terhubung di akun lain.
    snapshot JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Satu user/profile bisa memiliki banyak akun MT5
CREATE INDEX IF NOT EXISTS idx_user_mt5_accounts_user_id ON user_mt5_accounts (user_id);

-- Kompatibilitas untuk tabel lama: buang index unique duplikat/lama jika masih aktif.
-- (Ini INDEX, bukan CONSTRAINT -- makanya pakai DROP INDEX, bukan DROP CONSTRAINT.)
DROP INDEX IF EXISTS idx_user_mt5_accounts_user_unique;
DROP INDEX IF EXISTS idx_user_mt5_accounts_akun_unique;

-- ATURAN KLIEN: 1 user boleh memiliki banyak akun, tapi kombinasi (user_id, akun_id) unik,
-- dan 1 akun MT5 hanya boleh milik 1 profil/user saja.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_mt5_accounts_user_akun_unique'
  ) THEN
    ALTER TABLE user_mt5_accounts
      ADD CONSTRAINT user_mt5_accounts_user_akun_unique UNIQUE (user_id, akun_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_mt5_accounts_akun_id_unique'
  ) THEN
    ALTER TABLE user_mt5_accounts
      ADD CONSTRAINT user_mt5_accounts_akun_id_unique UNIQUE (akun_id);
  END IF;
END $$;

-- Kompatibilitas untuk yang sudah pernah menjalankan versi lama tabel ini.
ALTER TABLE user_mt5_accounts ADD COLUMN IF NOT EXISTS snapshot JSONB;

CREATE TABLE IF NOT EXISTS news_cache (
    id BIGSERIAL PRIMARY KEY,
    payload JSONB NOT NULL,
    fetched_at TIMESTAMPTZ DEFAULT NOW()
);