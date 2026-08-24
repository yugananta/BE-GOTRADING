// server/services/performanceService.js
//
// Layanan sentral untuk menghitung metrik performa portofolio dan drawdown
// berdasarkan histori transaksi riil, equity snapshots, dan balance operations.
//
// FORMULA:
// 1. total_pnl = current_equity - total_deposit + total_withdrawal
// 2. performance_pct = total_deposit > 0 ? (total_pnl / total_deposit) * 100 : 0
// 3. drawdown_pct = peak_equity > 0 ? Math.max(0, ((peak_equity - current_equity) / peak_equity) * 100) : 0
// 4. peak_equity diinisialisasi dari MAX(equity_snapshots.equity), dengan fallback minimal = initial_deposit / total_deposit.

import { supabase } from '../integrations/supabase/client.js';
import { queryTaraptiDb } from '../integrations/tarapti-db/pool.js';

/**
 * Simpan snapshot equity ke tabel equity_snapshots di TARAPTI DB dan Supabase JSONB
 */
export async function recordEquitySnapshot(row, { balance, equity, margin = 0, freeMargin = 0, profit = 0 }) {
  if (!row) return;

  const nowIso = new Date().toISOString();
  const balNum = parseFloat(balance) || 0;
  const eqNum = parseFloat(equity) || 0;
  const flNum = parseFloat(profit) || 0;
  const mgNum = parseFloat(margin) || 0;
  const fmNum = parseFloat(freeMargin) || 0;

  // 1. Simpan ke TARAPTI DB jika tersedia
  try {
    const { rows: akunRows } = await queryTaraptiDb(
      'SELECT id FROM akun WHERE login = $1',
      [row.akun_id]
    );
    const internalAkunId = akunRows[0]?.id;
    if (internalAkunId) {
      await queryTaraptiDb(
        `INSERT INTO equity_snapshots (akun_id, balance, equity, floating, margin, free_margin, recorded_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [internalAkunId, balNum, eqNum, flNum, mgNum, fmNum, nowIso]
      );
    }
  } catch (err) {
    console.warn('[PERF] Gagal insert ke equity_snapshots TARAPTI DB:', err.message);
  }

  // 2. Simpan juga riwayat ringkas ke snapshot.equity_snapshots (maks 100 record)
  try {
    const existingSnapshots = Array.isArray(row.snapshot?.equity_snapshots)
      ? row.snapshot.equity_snapshots
      : [];
    const updatedSnapshots = [
      ...existingSnapshots.slice(-99),
      { time: nowIso, balance: balNum, equity: eqNum, margin: mgNum, freeMargin: fmNum }
    ];

    await supabase
      .from('user_mt5_accounts')
      .update({
        snapshot: {
          ...row.snapshot,
          equity_snapshots: updatedSnapshots,
        }
      })
      .eq('id', row.id);
  } catch (e) {
    // Non-blocking
  }
}

/**
 * Hitung metrik performa portofolio lengkap untuk suatu akun
 */
export async function calculateAccountPerformance(row, gwAccount = null, gwDeals = null, tradesList = null) {
  if (!row) {
    return {
      total_deposit: 0,
      total_withdrawal: 0,
      initial_deposit: 0,
      peak_equity: 0,
      total_pnl: 0,
      performance_pct: 0,
      drawdown_pct: 0,
    };
  }

  const currentEquity = parseFloat(gwAccount?.equity ?? row.snapshot?.account?.equity ?? row.equity ?? 0);
  const currentBalance = parseFloat(gwAccount?.balance ?? row.snapshot?.account?.balance ?? row.balance ?? 0);

  let totalDeposit = 0;
  let totalWithdrawal = 0;
  let hasExplicitBalanceOps = false;

  // 1. Coba ambil deposit & withdrawal dari TARAPTI DB (balance_operations)
  try {
    const { rows: akunRows } = await queryTaraptiDb(
      'SELECT id FROM akun WHERE login = $1',
      [row.akun_id]
    );
    const internalAkunId = akunRows[0]?.id;
    if (internalAkunId) {
      const { rows: balRows } = await queryTaraptiDb(
        `SELECT
           COALESCE(SUM(amount) FILTER (WHERE amount > 0), 0) AS deposit_sum,
           COALESCE(SUM(ABS(amount)) FILTER (WHERE amount < 0), 0) AS withdraw_sum,
           COUNT(*) AS total_ops
         FROM balance_operations
         WHERE akun_id = $1`,
        [internalAkunId]
      );
      if (balRows && balRows[0] && parseInt(balRows[0].total_ops, 10) > 0) {
        totalDeposit = parseFloat(balRows[0].deposit_sum) || 0;
        totalWithdrawal = parseFloat(balRows[0].withdraw_sum) || 0;
        hasExplicitBalanceOps = true;
      }
    }
  } catch (err) {
    // Abaikan dan gunakan fallback di bawah
  }

  // 2. Fallback: Ekstrak dari MT5 history deals (gwDeals / snapshot.deals)
  if (!hasExplicitBalanceOps) {
    const deals = gwDeals || row.snapshot?.deals || [];
    if (Array.isArray(deals) && deals.length > 0) {
      let depSum = 0;
      let wthSum = 0;
      let foundDealBalance = false;
      for (const d of deals) {
        const typeStr = String(d.type ?? '').toUpperCase();
        const isBalance = typeStr === '2' || typeStr === 'BALANCE' || typeStr === 'DEAL_TYPE_BALANCE' || (!d.symbol && parseFloat(d.profit) !== 0);
        if (isBalance) {
          const amt = parseFloat(d.profit) || 0;
          if (amt > 0) depSum += amt;
          else if (amt < 0) wthSum += Math.abs(amt);
          foundDealBalance = true;
        }
      }
      if (foundDealBalance && depSum > 0) {
        totalDeposit = depSum;
        totalWithdrawal = wthSum;
        hasExplicitBalanceOps = true;
      }
    }
  }

  // 3. Fallback: Ekstrak dari daftar trades (tipe BALANCE)
  if (!hasExplicitBalanceOps) {
    const trades = tradesList || row.snapshot?.trades || [];
    if (Array.isArray(trades) && trades.length > 0) {
      let depSum = 0;
      let wthSum = 0;
      let foundTradeBalance = false;
      for (const t of trades) {
        const typeStr = String(t.type || '').toUpperCase();
        const comment = String(t.comment || '').toLowerCase();
        const isBalance = typeStr === 'BALANCE' || comment.includes('deposit') || comment.includes('balance') || (t.symbol === '' && parseFloat(t.pl) !== 0);
        if (isBalance) {
          const amt = parseFloat(t.pl) || 0;
          if (amt > 0) depSum += amt;
          else if (amt < 0) wthSum += Math.abs(amt);
          foundTradeBalance = true;
        }
      }
      if (foundTradeBalance && depSum > 0) {
        totalDeposit = depSum;
        totalWithdrawal = wthSum;
        hasExplicitBalanceOps = true;
      }
    }
  }

  // 4. Fallback jika belum ada catatan mutasi: gunakan nilai tersimpan atau saldo awal
  if (totalDeposit <= 0) {
    totalDeposit = parseFloat(row.total_deposit)
      || parseFloat(row.initial_deposit)
      || parseFloat(row.snapshot?.account?.total_deposit)
      || parseFloat(row.snapshot?.account?.totalDeposit)
      || currentBalance
      || 0;
  }

  const initialDeposit = parseFloat(row.initial_deposit) || totalDeposit || currentBalance || 0;

  // 5. Hitung peak_equity historis
  let maxHistoryEquity = 0;

  // 5a. Query MAX(equity) & MAX(balance) dari equity_snapshots TARAPTI DB
  try {
    const { rows: akunRows } = await queryTaraptiDb(
      'SELECT id FROM akun WHERE login = $1',
      [row.akun_id]
    );
    const internalAkunId = akunRows[0]?.id;
    if (internalAkunId) {
      const { rows: maxRows } = await queryTaraptiDb(
        `SELECT
           COALESCE(MAX(equity), 0) AS max_eq,
           COALESCE(MAX(balance), 0) AS max_bal
         FROM equity_snapshots
         WHERE akun_id = $1`,
        [internalAkunId]
      );
      if (maxRows && maxRows[0]) {
        maxHistoryEquity = Math.max(
          parseFloat(maxRows[0].max_eq) || 0,
          parseFloat(maxRows[0].max_bal) || 0
        );
      }
    }
  } catch (err) {
    // Abaikan
  }

  // 5b. Periksa riwayat snapshot di Supabase JSON
  const jsonSnapshots = Array.isArray(row.snapshot?.equity_snapshots)
    ? row.snapshot.equity_snapshots
    : [];
  for (const s of jsonSnapshots) {
    const eq = parseFloat(s.equity) || 0;
    const bal = parseFloat(s.balance) || 0;
    if (eq > maxHistoryEquity) maxHistoryEquity = eq;
    if (bal > maxHistoryEquity) maxHistoryEquity = bal;
  }

  // 5c. Periksa peak_equity yang sudah tersimpan sebelumnya
  const storedPeak = parseFloat(row.peak_equity)
    || parseFloat(row.snapshot?.account?.peak_equity)
    || parseFloat(row.snapshot?.account?.peakEquity)
    || 0;

  // 5d. Peak minimal adalah initial_deposit / total_deposit
  const minBaselinePeak = Math.max(initialDeposit, totalDeposit);

  // Peak final adalah titik tertinggi dari semua sumber data
  const peakEquity = Math.max(
    maxHistoryEquity,
    storedPeak,
    minBaselinePeak,
    currentEquity,
    currentBalance
  );

  // 6. Hitung Total P&L, Performance %, dan Drawdown %
  const totalPnl = currentEquity - totalDeposit + totalWithdrawal;
  const performancePct = totalDeposit > 0 ? (totalPnl / totalDeposit) * 100 : 0;
  const drawdownPct = peakEquity > 0
    ? Math.max(0, ((peakEquity - currentEquity) / peakEquity) * 100)
    : 0;

  return {
    total_deposit: Number(totalDeposit.toFixed(2)),
    total_withdrawal: Number(totalWithdrawal.toFixed(2)),
    initial_deposit: Number(initialDeposit.toFixed(2)),
    peak_equity: Number(peakEquity.toFixed(2)),
    total_pnl: Number(totalPnl.toFixed(2)),
    performance_pct: Number(performancePct.toFixed(2)),
    drawdown_pct: Number(drawdownPct.toFixed(2)),
    // camelCase aliases untuk kemudahan konsumsi frontend
    totalDeposit: Number(totalDeposit.toFixed(2)),
    totalWithdrawal: Number(totalWithdrawal.toFixed(2)),
    initialDeposit: Number(initialDeposit.toFixed(2)),
    peakEquity: Number(peakEquity.toFixed(2)),
    totalPnl: Number(totalPnl.toFixed(2)),
    performancePct: Number(performancePct.toFixed(2)),
    drawdownPct: Number(drawdownPct.toFixed(2)),
  };
}

/**
 * Backfill otomatis untuk semua akun existing di database Supabase
 */
export async function backfillAllAccountsPerformance() {
  try {
    console.log('[PERF-BACKFILL] Memulai proses backfill performa untuk seluruh akun MT5...');
    const { data: accounts, error } = await supabase
      .from('user_mt5_accounts')
      .select('*');

    if (error) {
      console.warn('[PERF-BACKFILL] Gagal mengambil akun dari Supabase:', error.message);
      return;
    }

    if (!accounts || accounts.length === 0) {
      console.log('[PERF-BACKFILL] Tidak ada akun untuk di-backfill.');
      return;
    }

    const { getAccountCredentials, getMergedTradesFromDbAndGateway } = await import('./metatraderService.js');
    const { getTrades, getDeals } = await import('../integrations/mt5-gateway/client.js');

    for (const acc of accounts) {
      let gwTrades = null;
      let gwDeals = [];
      const creds = getAccountCredentials(acc);

      // Jika trades kosong di snapshot dan credential tersimpan, fetch dari Gateway
      if (creds && acc.credential_saved && (!acc.snapshot?.trades || acc.snapshot.trades.length === 0)) {
        try {
          const [tRes, dRes] = await Promise.allSettled([
            getTrades(creds),
            getDeals(creds),
          ]);
          if (tRes.status === 'fulfilled' && tRes.value) gwTrades = tRes.value;
          if (dRes.status === 'fulfilled' && dRes.value) gwDeals = dRes.value?.deals || [];
        } catch (e) {
          console.warn(`[PERF-BACKFILL] Gagal fetch live trades untuk akun ${acc.akun_id}:`, e.message);
        }
      }

      const mergedTrades = await getMergedTradesFromDbAndGateway(acc, gwTrades, gwDeals, acc.snapshot?.trades);
      const metrics = await calculateAccountPerformance(acc, null, gwDeals, mergedTrades);
      console.log(`[PERF-BACKFILL] Akun ${acc.akun_id} (${acc.server}): ` +
        `Deposit=$${metrics.total_deposit}, Withdrawal=$${metrics.total_withdrawal}, ` +
        `Peak=$${metrics.peak_equity}, CurrentEquity=$${acc.snapshot?.account?.equity ?? acc.equity ?? 0}, ` +
        `TotalPnL=$${metrics.total_pnl}, Perf=${metrics.performance_pct}%, DD=${metrics.drawdown_pct}%, Trades=${mergedTrades.length}`);

      const updatedSnapshotAccount = {
        ...(acc.snapshot?.account || {}),
        ...metrics,
      };

      const finalTrades = mergedTrades.length > 0 ? mergedTrades : (acc.snapshot?.trades || []);

      await supabase
        .from('user_mt5_accounts')
        .update({
          peak_equity: metrics.peak_equity,
          total_deposit: metrics.total_deposit,
          total_withdrawal: metrics.total_withdrawal,
          initial_deposit: metrics.initial_deposit,
          snapshot: {
            ...acc.snapshot,
            account: updatedSnapshotAccount,
            trades: finalTrades,
            fetched_at: new Date().toISOString(),
          }
        })
        .eq('id', acc.id);
    }
    console.log(`[PERF-BACKFILL] ✅ Selesai backfill ${accounts.length} akun.`);
  } catch (err) {
    console.error('[PERF-BACKFILL] ❌ Error saat backfill:', err.message);
  }
}
