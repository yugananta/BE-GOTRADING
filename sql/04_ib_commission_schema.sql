-- tarapti-backend - Mesin Komisi IB (Introducing Broker)
-- Jalankan SETELAH sql/01_admin_schema.sql, sekali, di Supabase SQL Editor.
--
-- KENAPA INI ADA: sebelumnya role='ib' cuma dipakai untuk daftar downline
-- (lihat listIbs/getIbDownline di ibService.js). Itu belum "bisnis IB" --
-- IB sungguhan dibayar dari VOLUME TRADING (lot) downline-nya, bukan dari
-- jumlah downline saja. Tabel di bawah menghubungkan role IB dengan data
-- trading yang disinkronkan MT5 sync engine (TARAPTI DB terpisah, tabel
-- closed_trades_per_position) supaya ada komisi yang benar-benar terhitung.
--
-- CATATAN PENTING: source_akun_id & source_trade_ref di ib_commissions
-- MERUJUK ke TARAPTI DB (database Postgres terpisah untuk data MT5), jadi
-- SENGAJA TIDAK pakai FOREIGN KEY lintas-database. Constraint UNIQUE di
-- bawah yang mencegah satu closed trade dihitung komisinya dua kali.

ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE;
CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users (referral_code);

-- Tier komisi -- rate per lot naik sesuai jumlah downline aktif IB.
-- Silakan sesuaikan nilai rate_per_lot dengan kesepakatan bisnis kalian.
CREATE TABLE IF NOT EXISTS ib_commission_tiers (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,              -- contoh: 'Bronze', 'Silver', 'Gold'
    min_active_downline INT NOT NULL DEFAULT 0,
    rate_per_lot NUMERIC(10,4) NOT NULL,    -- nilai komisi (USD) per 1 lot standard
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS ib_tier_id BIGINT REFERENCES ib_commission_tiers(id);

-- Ledger komisi: satu baris = komisi dari satu closed trade downline.
CREATE TABLE IF NOT EXISTS ib_commissions (
    id BIGSERIAL PRIMARY KEY,
    ib_id UUID NOT NULL REFERENCES users(id),
    referred_user_id UUID NOT NULL REFERENCES users(id),
    source_akun_id INT NOT NULL,            -- akun.id di TARAPTI DB
    source_trade_ref TEXT NOT NULL,         -- id posisi/deal unik di closed_trades_per_position
    volume NUMERIC(12,2) NOT NULL,          -- lot yang dipakai untuk hitung komisi ini
    rate_applied NUMERIC(10,4) NOT NULL,
    amount NUMERIC(14,2) NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'paid', 'void')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (source_akun_id, source_trade_ref)   -- cegah dihitung dobel
);

CREATE INDEX IF NOT EXISTS idx_ib_commissions_ib ON ib_commissions (ib_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ib_commissions_referred ON ib_commissions (referred_user_id);

-- Pengajuan pencairan komisi
CREATE TABLE IF NOT EXISTS ib_payouts (
    id BIGSERIAL PRIMARY KEY,
    ib_id UUID NOT NULL REFERENCES users(id),
    amount NUMERIC(14,2) NOT NULL,
    method TEXT,                            -- bebas teks untuk MVP (bank/e-wallet)
    status TEXT NOT NULL DEFAULT 'requested'
        CHECK (status IN ('requested', 'processing', 'paid', 'rejected')),
    requested_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    processed_by UUID REFERENCES users(id),
    note TEXT
);

CREATE INDEX IF NOT EXISTS idx_ib_payouts_ib ON ib_payouts (ib_id, status);

-- Tier default -- GANTI angkanya sesuai kebijakan komisi kalian.
INSERT INTO ib_commission_tiers (name, min_active_downline, rate_per_lot) VALUES
    ('Bronze', 0, 2.00),
    ('Silver', 10, 3.00),
    ('Gold', 50, 4.50)
ON CONFLICT (name) DO NOTHING;
