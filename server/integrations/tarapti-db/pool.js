// server/integrations/tarapti-db/pool.js
import pg from 'pg';
import {
  TARAPTI_DB_HOST, TARAPTI_DB_PORT, TARAPTI_DB_USER,
  TARAPTI_DB_PASSWORD, TARAPTI_DB_NAME,
} from '../../config/env.js';

const { Pool } = pg;

export const taraptiDbPool = new Pool({
  host: TARAPTI_DB_HOST,
  port: TARAPTI_DB_PORT,
  user: TARAPTI_DB_USER,
  password: TARAPTI_DB_PASSWORD,
  database: TARAPTI_DB_NAME,
  max: 10,
  // Batas koneksi pendek agar error cepat terdeteksi, tidak hang lama
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 10000,
});

export async function queryTaraptiDb(text, params) {
  try {
    return await taraptiDbPool.query(text, params);
  } catch (err) {
    // TARAPTI DB tidak tersedia (env var tidak di-set atau koneksi gagal).
    // Kembalikan empty rows agar caller tidak crash saat DB offline.
    console.warn(
      '[TARAPTI DB] Query tidak dapat terhubung. Mengembalikan data kosong:',
      err.message
    );
    return { rows: [], rowCount: 0 };
  }
}
