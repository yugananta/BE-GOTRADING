// server/services/dashboardService.js
import { supabase } from '../integrations/supabase/client.js';
import { queryTaraptiDb } from '../integrations/tarapti-db/pool.js';

export async function getDashboardSummary() {
  const { count: totalUsers } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true });

  const { count: totalMt5Accounts } = await supabase
    .from('user_mt5_accounts')
    .select('*', { count: 'exact', head: true });

  const { rows: statusRows } = await queryTaraptiDb(
    `SELECT status, COUNT(*) AS count FROM fetch_queue GROUP BY status`
  );
  const accountsByStatus = { pending: 0, processing: 0, completed: 0, failed: 0 };
  for (const row of statusRows) {
    accountsByStatus[row.status] = parseInt(row.count, 10);
  }

  const { data: recentUsers } = await supabase
    .from('users')
    .select('created_at')
    .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

  const registrationsLast7Days = groupByDay(recentUsers || []);

  return { totalUsers: totalUsers || 0, totalMt5Accounts: totalMt5Accounts || 0, accountsByStatus, registrationsLast7Days };
}

function groupByDay(rows) {
  const counts = {};
  for (const row of rows) {
    const day = row.created_at.slice(0, 10); // YYYY-MM-DD
    counts[day] = (counts[day] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
