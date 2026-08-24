// server/services/logsService.js
//
// Log error sync MT5 -- dibaca langsung dari tabel `logs` di TARAPTI DB
// (read-only), bukan dari Supabase.

import { queryTaraptiDb } from '../integrations/tarapti-db/pool.js';

const PAGE_SIZE = 30;

export async function listSyncLogs({ page = 1, action }) {
  const offset = (page - 1) * PAGE_SIZE;
  const params = [];
  let where = '';
  if (action) {
    params.push(action);
    where = `WHERE action = $${params.length}`;
  }

  const { rows } = await queryTaraptiDb(
    `SELECT id, akun_id, worker_id, action, message, created_at
     FROM logs
     ${where}
     ORDER BY created_at DESC
     LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
    params
  );

  const { rows: countRows } = await queryTaraptiDb(`SELECT COUNT(*) FROM logs ${where}`, params);

  return { data: rows, total: parseInt(countRows[0].count, 10), page: Number(page) };
}
