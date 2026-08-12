// server/services/ibService.js
//
// Domain IB (Introducing Broker). Sebelumnya file ini cuma listIbs() +
// getIbDownline() -- itu daftar downline TANPA nilai bisnis. IB sungguhan
// dibayar dari volume trading (lot) downline-nya. Sekarang file ini juga
// menghitung, mencatat, dan mengelola komisi tersebut (lihat
// sql/04_ib_commission_schema.sql untuk skemanya).
//
// PENTING -- ASUMSI YANG WAJIB DICEK: fungsi calculateCommissionsForIb()
// mengasumsikan tabel `closed_trades_per_position` di TARAPTI DB punya
// kolom `id` (id unik posisi/deal) dan `volume` (lot). Cocokkan nama
// kolom ini dengan skema sync engine kalian yang sebenarnya (blueprint
// v4.7) sebelum dipakai di production -- kalau namanya beda, cukup ubah
// SELECT di bawah, struktur ib_commissions tidak perlu berubah.

import crypto from 'crypto';
import { supabase } from '../integrations/supabase/client.js';
import { queryTaraptiDb } from '../integrations/tarapti-db/pool.js';

const DEFAULT_TIER_NAME = 'Bronze';

// ---------------------------------------------------------------------
// Daftar IB & downline (fungsi lama, dipertahankan untuk admin panel)
// ---------------------------------------------------------------------

export async function listIbs() {
  const { data: ibs, error } = await supabase
    .from('users')
    .select('id, email, ib_region, country, province, city, created_at, referral_code, ib_tier_id')
    .eq('role', 'ib')
    .order('created_at', { ascending: false });

  if (error) throw error;

  const results = [];
  for (const ib of ibs) {
    const { count } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('referred_by', ib.id);
    results.push({ ...ib, downlineCount: count || 0 });
  }
  return results;
}

export async function getIbDownline(ibId) {
  const { data, error } = await supabase
    .from('users')
    .select('id, email, country, province, city, status, created_at')
    .eq('referred_by', ibId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------
// Kode referral -- setiap user dapat kode unik supaya pendaftar baru bisa
// pakai ?ref=KODE saat register, bukan cuma referredBy pakai UUID mentah.
// ---------------------------------------------------------------------

export async function ensureReferralCode(userId) {
  const { data: user, error } = await supabase
    .from('users')
    .select('referral_code')
    .eq('id', userId)
    .single();
  if (error) throw error;
  if (user.referral_code) return user.referral_code;

  // Retry beberapa kali kalau tabrakan kode (kemungkinan kecil, tapi jaga-jaga)
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = crypto.randomBytes(4).toString('hex').toUpperCase(); // contoh: 'A1B2C3D4'
    const { error: updateError } = await supabase
      .from('users')
      .update({ referral_code: code })
      .eq('id', userId);
    if (!updateError) return code;
  }
  throw new Error('Gagal membuat referral code, coba lagi');
}

export async function resolveReferralCode(code) {
  if (!code) return null;
  const { data, error } = await supabase
    .from('users')
    .select('id')
    .eq('referral_code', code)
    .maybeSingle();
  if (error) throw error;
  return data?.id || null;
}

// ---------------------------------------------------------------------
// Tier komisi
// ---------------------------------------------------------------------

export async function listTiers() {
  const { data, error } = await supabase
    .from('ib_commission_tiers')
    .select('*')
    .order('rate_per_lot', { ascending: true });
  if (error) throw error;
  return data;
}

export async function upsertTier({ name, minActiveDownline, ratePerLot }) {
  const { data, error } = await supabase
    .from('ib_commission_tiers')
    .upsert({ name, min_active_downline: minActiveDownline, rate_per_lot: ratePerLot }, { onConflict: 'name' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getActiveDownlineCount(ibId) {
  const { count } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true })
    .eq('referred_by', ibId)
    .eq('status', 'active');
  return count || 0;
}

// Naikkan tier IB otomatis berdasarkan jumlah downline aktif. Dipanggil
// dari calculateCommissionsForIb() supaya tier selalu up to date sebelum
// dipakai untuk hitung rate komisi.
async function syncTierForIb(ibId) {
  const activeDownline = await getActiveDownlineCount(ibId);
  const tiers = await listTiers();
  if (tiers.length === 0) {
    const err = new Error('Belum ada ib_commission_tiers -- jalankan sql/04_ib_commission_schema.sql');
    err.status = 500;
    throw err;
  }
  // Tier tertinggi yang syaratnya terpenuhi
  const eligible = tiers
    .filter((t) => activeDownline >= t.min_active_downline)
    .sort((a, b) => b.min_active_downline - a.min_active_downline)[0]
    || tiers.find((t) => t.name === DEFAULT_TIER_NAME) || tiers[0];

  await supabase.from('users').update({ ib_tier_id: eligible.id }).eq('id', ibId);
  return eligible;
}

// ---------------------------------------------------------------------
// Mesin komisi -- hitung komisi dari closed trade downline, catat ke
// ib_commissions (idempotent lewat UNIQUE(source_akun_id, source_trade_ref)).
// ---------------------------------------------------------------------

export async function calculateCommissionsForIb(ibId) {
  const tier = await syncTierForIb(ibId);

  const { data: downline, error: downlineError } = await supabase
    .from('users')
    .select('id')
    .eq('referred_by', ibId);
  if (downlineError) throw downlineError;
  if (!downline || downline.length === 0) return { inserted: 0, tier: tier.name };

  const downlineIds = downline.map((u) => u.id);
  const { data: mt5Links, error: linkError } = await supabase
    .from('user_mt5_accounts')
    .select('akun_id, user_id')
    .in('user_id', downlineIds);
  if (linkError) throw linkError;
  if (!mt5Links || mt5Links.length === 0) return { inserted: 0, tier: tier.name };

  const userByAkunId = Object.fromEntries(mt5Links.map((l) => [l.akun_id, l.user_id]));
  const akunIds = mt5Links.map((l) => l.akun_id);

  // Ambil trade yang BELUM ada di ib_commissions untuk akun-akun ini.
  // NOTE: sesuaikan nama kolom `id`/`volume` dengan skema TARAPTI DB kalian.
  const { rows: trades } = await queryTaraptiDb(
    `SELECT ctp.position_id AS trade_ref, ctp.akun_id, ctp.total_volume_closed AS volume
     FROM closed_trades_per_position ctp
     WHERE ctp.akun_id = ANY($1::int[])
       AND NOT EXISTS (
         SELECT 1 FROM dblink_placeholder -- lihat catatan di bawah
       )`,
    [akunIds]
  ).catch(async () => {
    // TARAPTI DB dan Supabase adalah database TERPISAH, jadi NOT EXISTS
    // lintas-DB di atas tidak bisa jalan langsung (butuh dblink/FDW).
    // Fallback aman untuk MVP: ambil semua trade akun terkait, lalu
    // filter yang sudah tercatat di Supabase secara manual di bawah.
    return queryTaraptiDb(
      `SELECT position_id AS trade_ref, akun_id, total_volume_closed AS volume
       FROM closed_trades_per_position
       WHERE akun_id = ANY($1::int[])`,
      [akunIds]
    );
  });

  if (!trades || trades.length === 0) return { inserted: 0, tier: tier.name };

  const { data: alreadyRecorded } = await supabase
    .from('ib_commissions')
    .select('source_akun_id, source_trade_ref')
    .in('source_akun_id', akunIds);
  const recordedSet = new Set((alreadyRecorded || []).map((r) => `${r.source_akun_id}:${r.source_trade_ref}`));

  const rowsToInsert = trades
    .filter((t) => !recordedSet.has(`${t.akun_id}:${t.trade_ref}`))
    .map((t) => ({
      ib_id: ibId,
      referred_user_id: userByAkunId[t.akun_id],
      source_akun_id: t.akun_id,
      source_trade_ref: String(t.trade_ref),
      volume: t.volume,
      rate_applied: tier.rate_per_lot,
      amount: Number(t.volume) * Number(tier.rate_per_lot),
    }));

  if (rowsToInsert.length === 0) return { inserted: 0, tier: tier.name };

  const { error: insertError } = await supabase.from('ib_commissions').insert(rowsToInsert);
  if (insertError) throw insertError;

  return { inserted: rowsToInsert.length, tier: tier.name };
}

// ---------------------------------------------------------------------
// Ringkasan & riwayat untuk IB yang bersangkutan (self-service, bukan admin)
// ---------------------------------------------------------------------

export async function getIbProfile(ibId) {
  const { data: user, error } = await supabase
    .from('users')
    .select('id, email, role, referral_code, ib_tier_id, ib_commission_tiers(name, rate_per_lot)')
    .eq('id', ibId)
    .single();
  if (error) throw error;

  if (user.role !== 'ib') {
    const err = new Error('User ini bukan IB');
    err.status = 403;
    throw err;
  }

  const referralCode = user.referral_code || (await ensureReferralCode(ibId));
  const activeDownline = await getActiveDownlineCount(ibId);

  const { data: earningsRows } = await supabase
    .from('ib_commissions')
    .select('amount, status')
    .eq('ib_id', ibId);

  const totals = (earningsRows || []).reduce(
    (acc, r) => {
      acc.total += Number(r.amount);
      if (r.status === 'paid') acc.paid += Number(r.amount);
      else acc.pending += Number(r.amount);
      return acc;
    },
    { total: 0, paid: 0, pending: 0 }
  );

  return {
    referralCode,
    tier: user.ib_commission_tiers?.name || null,
    ratePerLot: user.ib_commission_tiers?.rate_per_lot || null,
    activeDownline,
    earnings: totals,
  };
}

export async function listMyCommissions(ibId, { page = 1 } = {}) {
  const pageSize = 20;
  const from = (page - 1) * pageSize;
  const { data, error, count } = await supabase
    .from('ib_commissions')
    .select('id, referred_user_id, volume, rate_applied, amount, status, created_at', { count: 'exact' })
    .eq('ib_id', ibId)
    .order('created_at', { ascending: false })
    .range(from, from + pageSize - 1);
  if (error) throw error;
  return { data, total: count || 0, page: Number(page) };
}

// ---------------------------------------------------------------------
// Payout (pencairan)
// ---------------------------------------------------------------------

export async function requestPayout(ibId, { amount, method }) {
  if (!amount || amount <= 0) {
    const err = new Error('Jumlah payout tidak valid');
    err.status = 400;
    throw err;
  }
  const profile = await getIbProfile(ibId);
  const availableBalance = profile.earnings.pending; // komisi yang belum dibayar
  if (amount > availableBalance) {
    const err = new Error('Jumlah melebihi saldo komisi yang tersedia');
    err.status = 400;
    throw err;
  }
  const { data, error } = await supabase
    .from('ib_payouts')
    .insert({ ib_id: ibId, amount, method })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function listPayouts({ status } = {}) {
  let query = supabase.from('ib_payouts').select('*, users!ib_payouts_ib_id_fkey(email)').order('requested_at', { ascending: false });
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function updatePayoutStatus(payoutId, { status, processedBy, note }) {
  const { data, error } = await supabase
    .from('ib_payouts')
    .update({ status, processed_by: processedBy, processed_at: new Date().toISOString(), note })
    .eq('id', payoutId)
    .select()
    .single();
  if (error) throw error;

  // Kalau payout ditandai 'paid', tandai juga komisi terkait sebagai 'paid'
  // (MVP: tandai semua komisi 'pending' milik IB ini -- untuk kontrol lebih
  // presisi per-payout, tambahkan kolom payout_id di ib_commissions nanti).
  if (status === 'paid') {
    await supabase
      .from('ib_commissions')
      .update({ status: 'paid' })
      .eq('ib_id', data.ib_id)
      .eq('status', 'pending');
  }
  return data;
}
