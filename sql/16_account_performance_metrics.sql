-- 16_account_performance_metrics.sql
-- Tracking peak equity, initial deposit, total deposit, and total withdrawal for accurate portfolio performance & drawdown calculation

ALTER TABLE user_mt5_accounts ADD COLUMN IF NOT EXISTS peak_equity NUMERIC(20,2) DEFAULT 0;
ALTER TABLE user_mt5_accounts ADD COLUMN IF NOT EXISTS total_deposit NUMERIC(20,2) DEFAULT 0;
ALTER TABLE user_mt5_accounts ADD COLUMN IF NOT EXISTS total_withdrawal NUMERIC(20,2) DEFAULT 0;
ALTER TABLE user_mt5_accounts ADD COLUMN IF NOT EXISTS initial_deposit NUMERIC(20,2) DEFAULT 0;
ALTER TABLE user_mt5_accounts ADD COLUMN IF NOT EXISTS total_pnl NUMERIC(20,2) DEFAULT 0;
ALTER TABLE user_mt5_accounts ADD COLUMN IF NOT EXISTS performance_pct NUMERIC(10,2) DEFAULT 0;
ALTER TABLE user_mt5_accounts ADD COLUMN IF NOT EXISTS drawdown_pct NUMERIC(10,2) DEFAULT 0;
