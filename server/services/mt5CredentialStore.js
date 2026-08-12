// server/services/mt5CredentialStore.js
//
// Enkripsi/dekripsi credential MT5 (investor password) agar bisa disimpan
// secara PERSISTENT dan AMAN di database, lalu dipakai ulang untuk
// auto-reconnect -- tanpa pernah menyimpan plaintext, tanpa pernah
// mengirim password ke Frontend, dan tanpa pernah menuliskannya di log.
//
// Skema: AES-256-GCM dengan kunci dari environment variable
// `MT5_CREDENTIAL_ENCRYPTION_KEY` (32-byte, format base64 atau hex 64).
// Jika variabel belum diset, kunci diturunkan secara deterministik dari
// JWT_ACCESS_SECRET supaya fitur tetap jalan di deploy lama -- TAPI
// disarankan segera set MT5_CREDENTIAL_ENCRYPTION_KEY di Railway.
//
// Format payload: v1:<iv base64>:<authTag base64>:<ciphertext base64>

import crypto from 'crypto';
import { MT5_CREDENTIAL_ENCRYPTION_KEY, JWT_ACCESS_SECRET, SUPABASE_SERVICE_ROLE_KEY } from '../config/env.js';

function getKey() {
  const configured = (MT5_CREDENTIAL_ENCRYPTION_KEY || '').trim();
  if (configured) {
    const base64 = Buffer.from(configured, 'base64');
    if (base64.length === 32) return base64;
    if (/^[0-9a-fA-F]{64}$/.test(configured)) {
      return Buffer.from(configured, 'hex');
    }
    // Bukan base64 32-byte ataupun hex 64 -- biarkan di-warn di bawah,
    // lalu fallback ke derived key supaya tidak crash.
    console.warn(
      '[MT5-CRED] MT5_CREDENTIAL_ENCRYPTION_KEY tidak valid (harus 32-byte base64 atau 64-char hex). ' +
      'Fallback ke derived key dari database config.'
    );
  }
  // Gunakan SUPABASE_SERVICE_ROLE_KEY yang stabil & aman sebagai fallback utama
  // agar kunci dekripsi tidak berubah saat JWT_ACCESS_SECRET di-regenerate atau Railway di-restart.
  return crypto
    .createHash('sha256')
    .update(SUPABASE_SERVICE_ROLE_KEY || JWT_ACCESS_SECRET || 'tarapti-local-dev')
    .digest();
}

export function encryptPassword(plain) {
  if (plain == null || plain === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptPassword(payload) {
  if (!payload) return null;
  const parts = String(payload).split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  const [, ivB64, tagB64, dataB64] = parts;
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      getKey(),
      Buffer.from(ivB64, 'base64')
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch (err) {
    console.warn('[MT5-CRED] Gagal mendekripsi credential tersimpan:', err.message);
    return null;
  }
}

export { encryptPassword as encrypt, decryptPassword as decrypt };
