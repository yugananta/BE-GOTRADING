-- 00_0_sync_engine_tables.sql
-- MT5 Sync Engine Core Tables (Step 5 Blueprint)
-- ---------------------------------------------------------------
-- Jalankan paling awal agar tabel-tabel sync tersedia bagi
-- view analitik dan IB yang merujuk padanya.

CREATE TABLE IF NOT EXISTS akun (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(50) NOT NULL,
    login BIGINT NOT NULL UNIQUE,
    password_investor VARCHAR(255) NOT NULL,
    server VARCHAR(100) NOT NULL,
    broker VARCHAR(100),
    platform VARCHAR(10) DEFAULT 'MT5',
    account_type VARCHAR(20),
    currency VARCHAR(10),
    leverage INT,
    mt5_instance_path VARCHAR(255) DEFAULT 'C:\MT5\Instance_01',
    status VARCHAR(10) DEFAULT 'active' CHECK (status IN ('active','inactive')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fetch_queue (
    id SERIAL PRIMARY KEY,
    akun_id INT NOT NULL UNIQUE REFERENCES akun(id) ON DELETE CASCADE,
    status VARCHAR(15) DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
    worker_id VARCHAR(50),
    locked_at TIMESTAMPTZ,
    sync_started_at TIMESTAMPTZ,
    sync_finished_at TIMESTAMPTZ,
    last_updated TIMESTAMPTZ,
    next_retry_at TIMESTAMPTZ,
    retries INT DEFAULT 0,
    error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_queue_status ON fetch_queue (status);
CREATE INDEX IF NOT EXISTS idx_queue_retry ON fetch_queue (next_retry_at);

CREATE TABLE IF NOT EXISTS logs (
    id SERIAL PRIMARY KEY,
    akun_id INT,
    worker_id VARCHAR(50),
    action VARCHAR(50),
    message TEXT,
    stacktrace TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_logs_action_created ON logs (action, created_at);

CREATE TABLE IF NOT EXISTS worker_registry (
    worker_id VARCHAR(50) PRIMARY KEY,
    hostname VARCHAR(100),
    pid INT,
    heartbeat TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ DEFAULT NOW(),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','stopped'))
);

CREATE TABLE IF NOT EXISTS account_snapshot (
    akun_id INT PRIMARY KEY REFERENCES akun(id) ON DELETE CASCADE,
    balance NUMERIC(20,2),
    equity NUMERIC(20,2),
    profit NUMERIC(20,2),
    margin NUMERIC(20,2),
    free_margin NUMERIC(20,2),
    margin_level NUMERIC(10,2),
    credit NUMERIC(20,2),
    last_update TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS open_positions (
    ticket BIGINT PRIMARY KEY,
    akun_id INT NOT NULL REFERENCES akun(id) ON DELETE CASCADE,
    symbol VARCHAR(20),
    side VARCHAR(4),
    volume NUMERIC(10,2),
    open_price NUMERIC(20,5),
    current_price NUMERIC(20,5),
    sl NUMERIC(20,5),
    tp NUMERIC(20,5),
    profit NUMERIC(20,2),
    swap NUMERIC(20,2),
    commission NUMERIC(20,2),
    open_time TIMESTAMPTZ,
    magic_number BIGINT,
    comment TEXT,
    last_seen TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_openpos_akun ON open_positions (akun_id);
CREATE INDEX IF NOT EXISTS idx_openpos_last_seen ON open_positions (last_seen);

CREATE TABLE IF NOT EXISTS pending_orders (
    ticket BIGINT PRIMARY KEY,
    akun_id INT NOT NULL REFERENCES akun(id) ON DELETE CASCADE,
    symbol VARCHAR(20),
    order_type VARCHAR(20),
    volume NUMERIC(10,2),
    price NUMERIC(20,5),
    sl NUMERIC(20,5),
    tp NUMERIC(20,5),
    status VARCHAR(15) DEFAULT 'pending',
    setup_time TIMESTAMPTZ,
    expiration TIMESTAMPTZ,
    last_seen TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pendorder_akun ON pending_orders (akun_id);
CREATE INDEX IF NOT EXISTS idx_pendorder_last_seen ON pending_orders (last_seen);

CREATE TABLE IF NOT EXISTS closed_trades (
    ticket BIGINT PRIMARY KEY,
    akun_id INT NOT NULL REFERENCES akun(id) ON DELETE CASCADE,
    position_id BIGINT,
    symbol VARCHAR(20),
    side VARCHAR(4),
    volume NUMERIC(10,2),
    open_time TIMESTAMPTZ,
    close_time TIMESTAMPTZ,
    open_price NUMERIC(20,5),
    close_price NUMERIC(20,5),
    profit NUMERIC(20,2),
    swap NUMERIC(20,2),
    commission NUMERIC(20,2),
    duration_seconds INT,
    sl NUMERIC(20,5),
    tp NUMERIC(20,5),
    magic_number BIGINT,
    comment TEXT,
    open_time_source VARCHAR(15) DEFAULT 'unknown',
    deal_entry_type SMALLINT,
    is_partial BOOLEAN DEFAULT FALSE,
    synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_closedtrades_akun_time ON closed_trades (akun_id, close_time);
CREATE INDEX IF NOT EXISTS idx_closedtrades_symbol ON closed_trades (akun_id, symbol);
CREATE INDEX IF NOT EXISTS idx_closedtrades_position ON closed_trades (akun_id, position_id);

CREATE TABLE IF NOT EXISTS balance_operations (
    ticket BIGINT PRIMARY KEY,
    akun_id INT NOT NULL REFERENCES akun(id) ON DELETE CASCADE,
    op_type VARCHAR(30) NOT NULL,
    amount NUMERIC(20,2),
    time TIMESTAMPTZ,
    comment TEXT,
    synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_balanceops_akun_time ON balance_operations (akun_id, time);

CREATE TABLE IF NOT EXISTS equity_snapshots (
    id BIGSERIAL,
    akun_id INT NOT NULL REFERENCES akun(id) ON DELETE CASCADE,
    balance NUMERIC(20,2),
    equity NUMERIC(20,2),
    floating NUMERIC(20,2),
    margin NUMERIC(20,2),
    free_margin NUMERIC(20,2),
    recorded_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id, recorded_at)
) PARTITION BY RANGE (recorded_at);

CREATE INDEX IF NOT EXISTS idx_equitysnap_akun_time ON equity_snapshots (akun_id, recorded_at);

-- Default partition for equity_snapshots to handle all records automatically
CREATE TABLE IF NOT EXISTS equity_snapshots_default PARTITION OF equity_snapshots DEFAULT;

CREATE TABLE IF NOT EXISTS sync_checkpoints (
    akun_id INT PRIMARY KEY REFERENCES akun(id) ON DELETE CASCADE,
    last_successful_date DATE,
    total_deals_synced BIGINT DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
