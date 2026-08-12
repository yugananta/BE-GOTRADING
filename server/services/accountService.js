// server/services/accountService.js
//
// Menggabungkan integrations/mt5-gateway + Supabase. Route memanggil
// fungsi di file ini, TIDAK memanggil mt5-gateway atau Supabase langsung.
//
// [INTEGRASI] Gateway live adalah jembatan satu sesi tanpa endpoint
// register/status per akun (lihat mt5-gateway/client.js). Jadi "connect"
// memverifikasi gateway (GET /account) lalu menyimpan tautan di
// user_mt5_accounts, dan "status" membaca ulang data live dari gateway.

import { getAccount, getPositions } from '../integrations/mt5-gateway/client.js';
import { supabase } from '../integrations/supabase/client.js';

export async function connectMt5Account(userId, formData) {
  const gw = await getAccount();

  const akunId = Number(gw.login) || Number(formData.login) || 0;
  if (!akunId) {
    const err = new Error('Akun MT5 tidak terdeteksi di gateway.');
    err.status = 502;
    throw err;
  }

  const { error: deleteError } = await supabase
    .from('user_mt5_accounts')
    .delete()
    .eq('user_id', userId);
  if (deleteError) throw deleteError;

  const { data, error } = await supabase
    .from('user_mt5_accounts')
    .insert({ user_id: userId, akun_id: akunId, status: 'connected' })
    .select('*')
    .single();
  if (error) throw error;

  return { akun_id: data.akun_id, status: data.status, login: gw.login, server: gw.server };
}

export async function checkMt5AccountStatus(akunId) {
  const gw = await getAccount();
  const positions = await getPositions();
  return {
    akun_id: Number(akunId),
    status: 'connected',
    login: gw.login,
    server: gw.server,
    open_positions: positions.count || 0,
  };
}
