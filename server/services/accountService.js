// server/services/accountService.js
//
// Legacy compatibility wrapper. Semua pemanggilan akun MT5 dialihkan
// ke metatraderService.js (stateless gateway model).

import { listMyAccounts, getMyPositions } from './metatraderService.js';

export async function connectMt5Account(userId, formData) {
  const err = new Error('Gunakan /api/metatrader/connect untuk menghubungkan akun MT5.');
  err.status = 400;
  throw err;
}

export async function checkMt5AccountStatus(akunId) {
  return {
    akun_id: Number(akunId),
    status: 'connected',
  };
}
