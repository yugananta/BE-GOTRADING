-- TARAPTI Analytics Engine - View closed_trades per position
-- Jalankan di TARAPTI DB PostgreSQL untuk menyediakan agregasi trading per posisi.
-- 

CREATE OR REPLACE VIEW closed_trades_per_position AS
SELECT
    akun_id,
    position_id,
    symbol,
    MIN(open_time) AS open_time,
    MAX(close_time) AS close_time,
    SUM(profit) AS total_profit,
    SUM(swap) AS total_swap,
    SUM(commission) AS total_commission,
    SUM(volume) AS total_volume_closed,
    COUNT(*) AS jumlah_partial,
    BOOL_OR(is_partial) AS pernah_partial,
    BOOL_OR(deal_entry_type = 3) AS pernah_close_by,
    MAX(open_time_source) AS open_time_source
FROM closed_trades
WHERE position_id IS NOT NULL
GROUP BY akun_id, position_id, symbol;
