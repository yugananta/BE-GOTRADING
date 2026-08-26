-- Migration 18: Account Validations Table for IB GoTrading Validation Flow
-- Memastikan hanya akun MT5 yang sudah tervalidasi under IB GoTrading yang bisa connect.

CREATE TABLE IF NOT EXISTS account_validations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL,
    mt5_account_number TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    rejection_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_account_validations_user_id ON account_validations (user_id);
CREATE INDEX IF NOT EXISTS idx_account_validations_status ON account_validations (status);
CREATE INDEX IF NOT EXISTS idx_account_validations_mt5_account_number ON account_validations (mt5_account_number);
CREATE INDEX IF NOT EXISTS idx_account_validations_created_at ON account_validations (created_at DESC);
