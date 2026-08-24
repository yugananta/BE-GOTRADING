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
  connectionTimeoutMillis: 3000,
  idleTimeoutMillis: 10000,
});

let lastErrorTime = 0;

export async function queryTaraptiDb(text, params) {
  try {
    return await taraptiDbPool.query(text, params);
  } catch (err) {
    const now = Date.now();
    // Only log warning once every 5 minutes to avoid spamming logs with password authentication failed
    if (now - lastErrorTime > 300000) {
      console.warn(
        '[TARAPTI DB] Query tidak dapat terhubung. Mengembalikan data kosong:',
        err.message
      );
      lastErrorTime = now;
    }
    return { rows: [], rowCount: 0 };
  }
}

