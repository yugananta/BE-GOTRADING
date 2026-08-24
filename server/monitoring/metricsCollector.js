// server/monitoring/metricsCollector.js
// STEP 14 — Live collector yang mengupdate gauge sebelum /metrics di-scrape.
//
// Dijalankan sekali per scrape (lazy) dari route /metrics.
// Menggunakan query ringan COUNT(*) saja — tidak berdampak signifikan ke DB.

import { queryTaraptiDb } from '../integrations/tarapti-db/pool.js';
import {
  QUEUE_PENDING, QUEUE_FAILED, WORKER_ACTIVE, EQUITY_SNAPSHOTS_SIZE_BYTES,
} from './metrics.js';

export async function refreshQueueMetrics() {
  try {
    // Satu query: hitung pending, failed, processing sekaligus
    const { rows } = await queryTaraptiDb(
      `SELECT status, COUNT(*) AS cnt
       FROM fetch_queue
       GROUP BY status`,
      []
    );

    let pending = 0;
    let failed  = 0;
    for (const r of rows) {
      if (r.status === 'pending')    pending = parseInt(r.cnt, 10);
      if (r.status === 'failed')     failed  = parseInt(r.cnt, 10);
    }
    QUEUE_PENDING.set(pending);
    QUEUE_FAILED.set(failed);
  } catch {
    // DB tidak tersedia — tidak update gauge (nilai sebelumnya dipertahankan)
  }
}

export async function refreshWorkerMetrics() {
  try {
    const { rows } = await queryTaraptiDb(
      `SELECT COUNT(*) AS cnt FROM worker_registry WHERE status = 'active'`,
      []
    );
    WORKER_ACTIVE.set(parseInt(rows[0]?.cnt ?? 0, 10));
  } catch {
    // DB tidak tersedia — skip
  }
}

// Alert #4 — ukuran tabel equity_snapshots (termasuk seluruh partisi bulanan)
// dan index/TOAST-nya, tanpa query berat. Pakai katalog pg.
export async function refreshEquitySnapshotSize() {
  try {
    const { rows } = await queryTaraptiDb(
      `SELECT COALESCE(SUM(pg_total_relation_size(
                quote_ident(n.nspname) || '.' || quote_ident(c.relname))), 0) AS size_bytes
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relname = 'equity_snapshots'`,
      []
    );
    EQUITY_SNAPSHOTS_SIZE_BYTES.set(parseInt(rows[0]?.size_bytes ?? '0', 10));
  } catch {
    // DB tidak tersedia — pertahankan nilai sebelumnya
  }
}
