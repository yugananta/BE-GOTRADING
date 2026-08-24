// server/services/mt5AdminService.js
//
// STEP 11 — AI Coach Data Contract (Bab 16) ditambahkan via getCoachContract().
//
// Baca data MT5 langsung dari TARAPTI DB (read-only pool) untuk laporan
// admin -- lebih efisien daripada panggil HTTP API per akun untuk data
// tabular besar. Operasi TULIS (resync) tetap lewat mt5-gateway/client.js.

import { queryTaraptiDb } from '../integrations/tarapti-db/pool.js';
import { getAccount, getTrades, gatewayResync } from '../integrations/mt5-gateway/client.js';
import { supabase } from '../integrations/supabase/client.js';

const PAGE_SIZE = 20;

export async function listMt5Accounts({ page = 1, status }) {
  const offset = (page - 1) * PAGE_SIZE;
  const params = [];
  let where = '';
  if (status) {
    params.push(status);
    where = `WHERE q.status = $${params.length}`;
  }

  const { rows } = await queryTaraptiDb(
    `SELECT a.id, a.login, a.server, a.broker, a.status AS account_status,
            q.status AS sync_status, q.last_updated, q.error_message,
            s.balance, s.equity, s.profit
     FROM akun a
     LEFT JOIN fetch_queue q ON q.akun_id = a.id
     LEFT JOIN account_snapshot s ON s.akun_id = a.id
     ${where}
     ORDER BY a.id DESC
     LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
    params
  );

  const { rows: countRows } = await queryTaraptiDb(
    `SELECT COUNT(*) FROM akun a LEFT JOIN fetch_queue q ON q.akun_id = a.id ${where}`,
    params
  );

  // Lampirkan email user pemilik (dari Supabase, bukan TARAPTI DB)
  const akunIds = rows.map((r) => r.id);
  let ownerByAkunId = {};
  if (akunIds.length > 0) {
    const { data: links } = await supabase
      .from('user_mt5_accounts')
      .select('akun_id, users(email)')
      .in('akun_id', akunIds);
    ownerByAkunId = Object.fromEntries((links || []).map((l) => [l.akun_id, l.users?.email]));
  }

  const data = rows.map((r) => ({ ...r, ownerEmail: ownerByAkunId[r.id] || null }));

  return { data, total: parseInt(countRows[0].count, 10), page: Number(page) };
}

// [INTEGRASI] Panggil endpoint /resync di gateway untuk memaksa status akun 'pending' di fetch_queue.
export async function resyncAccount(akunId) {
  return await gatewayResync(akunId);
}

export async function getAccountAnalytics(akunId) {
  const { rows } = await queryTaraptiDb(
    `SELECT
        COUNT(*) AS total_posisi,
        COUNT(*) FILTER (WHERE total_profit > 0) AS posisi_profit,
        SUM(total_profit) AS net_profit
     FROM closed_trades_per_position
     WHERE akun_id = $1`,
    [akunId]
  );
  const row = rows[0] || {};
  const totalPosisi = parseInt(row.total_posisi, 10) || 0;
  const posisiProfit = parseInt(row.posisi_profit, 10) || 0;

  const { rows: equityRows } = await queryTaraptiDb(
    `SELECT recorded_at, equity, balance
     FROM equity_snapshots
     WHERE akun_id = $1
     ORDER BY recorded_at ASC
     LIMIT 500`,
    [akunId]
  );

  let peakEquity = 0;
  let maxDrawdownPct = 0;
  for (const r of equityRows) {
    const eq = parseFloat(r.equity) || 0;
    if (eq > peakEquity) peakEquity = eq;
    if (peakEquity > 0) {
      const dd = ((peakEquity - eq) / peakEquity) * 100;
      if (dd > maxDrawdownPct) maxDrawdownPct = dd;
    }
  }

  return {
    totalPosisi,
    winRate: totalPosisi > 0 ? Number(((posisiProfit / totalPosisi) * 100).toFixed(2)) : 0,
    netProfit: parseFloat(row.net_profit) || 0,
    peakEquity: Number(peakEquity.toFixed(2)),
    maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
    equityCurve: equityRows.map((r) => ({ time: r.recorded_at, equity: r.equity, balance: r.balance })),
  };
}

// ---------------------------------------------------------------------------
// STEP 11 — AI COACH DATA CONTRACT (BAB 16)
// ---------------------------------------------------------------------------
// Menghasilkan JSON sesuai schema v1.0 yang wajib dipenuhi sebelum diteruskan
// ke ai_coach. Berisi statistik hari ini (today) dan 7 hari terakhir (last_7_days).
// ---------------------------------------------------------------------------
export async function getCoachContract(akunId) {
  // --- today ---
  const { rows: todayRows } = await queryTaraptiDb(
    `SELECT
        COUNT(*)                                     AS total_positions,
        COUNT(*) FILTER (WHERE total_profit > 0)     AS winning_positions,
        COALESCE(SUM(total_profit),  0)              AS net_profit,
        COALESCE(MIN(total_profit),  0)              AS worst_trade,
        COALESCE(
          AVG(EXTRACT(EPOCH FROM (close_time - open_time)) / 3600.0),
          0
        )                                            AS avg_hold_hours
     FROM closed_trades_per_position
     WHERE akun_id = $1
       AND DATE(close_time) = CURRENT_DATE`,
    [akunId]
  );

  // --- last 7 days ---
  const { rows: weekRows } = await queryTaraptiDb(
    `SELECT
        COUNT(*)                                     AS total_positions,
        COUNT(*) FILTER (WHERE total_profit > 0)     AS winning_positions,
        COALESCE(SUM(total_profit),  0)              AS net_profit,
        COALESCE(MIN(total_profit),  0)              AS worst_trade,
        COALESCE(
          AVG(EXTRACT(EPOCH FROM (close_time - open_time)) / 3600.0),
          0
        )                                            AS avg_hold_hours
     FROM closed_trades_per_position
     WHERE akun_id = $1
       AND close_time >= NOW() - INTERVAL '7 days'`,
    [akunId]
  );

  // --- equity snapshots last 7 days (for Sharpe & exposure_pct & peak-to-trough DD) ---
  const { rows: snapRows } = await queryTaraptiDb(
    `SELECT recorded_at, equity, balance
     FROM equity_snapshots
     WHERE akun_id = $1
       AND recorded_at >= NOW() - INTERVAL '7 days'
     ORDER BY recorded_at ASC`,
    [akunId]
  );

  // ---- helpers ----
  const toFloat = (v) => parseFloat(v) || 0;
  const toInt   = (v) => parseInt(v,  10) || 0;

  // Hitung peak-to-trough max drawdown dari equity snapshots
  const calculateSnapshotDrawdown = (snapshots) => {
    let peak = 0;
    let maxDd = 0;
    for (const s of snapshots) {
      const eq = toFloat(s.equity);
      if (eq > peak) peak = eq;
      if (peak > 0) {
        const dd = ((peak - eq) / peak) * 100;
        if (dd > maxDd) maxDd = dd;
      }
    }
    return Number(maxDd.toFixed(2));
  };

  const weekDrawdown = calculateSnapshotDrawdown(snapRows);

  const buildPeriod = (row, drawdownOverride = null) => {
    const total   = toInt(row.total_positions);
    const winning = toInt(row.winning_positions);
    const dd = drawdownOverride !== null
      ? drawdownOverride
      : (toFloat(row.worst_trade) < 0 ? Math.abs(toFloat(row.worst_trade)) : 0);
    return {
      net_profit:      Number(toFloat(row.net_profit).toFixed(2)),
      total_positions: total,
      win_rate:        total > 0 ? Number(((winning / total) * 100).toFixed(2)) : 0,
      max_drawdown:    Number(dd.toFixed(2)),
      avg_hold_hours:  Number(toFloat(row.avg_hold_hours).toFixed(2)),
    };
  };

  // Sharpe ratio (annualised daily returns, 7-day window)
  const sharpeRatio = (() => {
    if (snapRows.length < 2) return 0;
    const dailyReturns = [];
    for (let i = 1; i < snapRows.length; i++) {
      const prev = toFloat(snapRows[i - 1].equity);
      const curr = toFloat(snapRows[i].equity);
      if (prev > 0) dailyReturns.push((curr - prev) / prev);
    }
    if (dailyReturns.length === 0) return 0;
    const mean = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length;
    const variance = dailyReturns.reduce((s, r) => s + Math.pow(r - mean, 2), 0)
                     / dailyReturns.length;
    const stdDev = Math.sqrt(variance);
    return stdDev === 0 ? 0 : Number(((mean / stdDev) * Math.sqrt(252)).toFixed(2));
  })();

  // exposure_pct = avg (equity - balance) / balance * 100 over 7-day snapshots
  const exposurePct = (() => {
    if (snapRows.length === 0) return 0;
    let validCount = 0;
    const total = snapRows.reduce((s, r) => {
      const bal = toFloat(r.balance);
      if (bal <= 0) return s;
      validCount++;
      return s + (Math.abs(toFloat(r.equity) - bal) / bal) * 100;
    }, 0);
    return validCount === 0 ? 0 : Number((total / validCount).toFixed(2));
  })();

  const todayPeriod = buildPeriod(todayRows[0] || {});
  const weekPeriod  = buildPeriod(weekRows[0]  || {}, weekDrawdown);

  return {
    schema_version: '1.0',
    today:        todayPeriod,
    last_7_days:  {
      ...weekPeriod,
      sharpe_ratio: sharpeRatio,
      exposure_pct: exposurePct,
    },
  };
}

export async function getAccountTransactions(akunId, { page = 1, type }) {
  const offset = (page - 1) * PAGE_SIZE;
  const params = [akunId];
  let where = 'WHERE akun_id = $1';
  if (type) {
    params.push(type);
    where += ` AND op_type = $${params.length}`;
  }

  const { rows } = await queryTaraptiDb(
    `SELECT ticket, op_type, amount, time, comment
     FROM balance_operations
     ${where}
     ORDER BY time DESC
     LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
    params
  );

  const { rows: countRows } = await queryTaraptiDb(
    `SELECT COUNT(*) FROM balance_operations ${where}`,
    params
  );

  return { data: rows, total: parseInt(countRows[0].count, 10), page: Number(page) };
}
