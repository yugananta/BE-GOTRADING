-- tarapti-backend - Migrasi skema untuk Admin Panel
-- Jalankan SETELAH sql/00_backend_tables.sql, sekali, di Supabase SQL Editor.

-- Kolom tambahan di users: role, referral IB, verifikasi, status akun
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user'
    CHECK (role IN ('user', 'ib', 'admin'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES users(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS ib_region TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified', 'pending', 'verified'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended'));

CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);
CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users (referred_by);
CREATE INDEX IF NOT EXISTS idx_users_country_province_city ON users (country, province, city);

-- Audit log aksi admin (siapa mengubah apa, kapan)
CREATE TABLE IF NOT EXISTS admin_audit_log (
    id BIGSERIAL PRIMARY KEY,
    admin_id UUID NOT NULL REFERENCES users(id),
    action TEXT NOT NULL,           -- contoh: 'suspend_user', 'resync_account', 'promote_admin'
    target_type TEXT,               -- contoh: 'user', 'mt5_account'
    target_id TEXT,
    detail JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_admin ON admin_audit_log (admin_id, created_at);

-- News yang dibuat manual oleh admin (beda dari news_cache yang isinya
-- hasil fetch API luar -- tabel ini untuk pengumuman/berita internal).
CREATE TABLE IF NOT EXISTS news_posts (
    id BIGSERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    author_id UUID REFERENCES users(id),
    published BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- WAJIB DIJALANKAN MANUAL SEKALI: jadikan diri kamu admin pertama.
-- TIDAK ADA endpoint API untuk self-promote ke admin (sengaja,
-- demi keamanan) -- harus lewat SQL langsung di Supabase.
-- Ganti email di bawah dengan email akun kamu yang SUDAH terdaftar
-- lewat POST /api/auth/register.
-- ============================================================
-- UPDATE users SET role = 'admin' WHERE email = 'email_kamu@contoh.com';
