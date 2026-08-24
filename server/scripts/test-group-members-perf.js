import { supabase } from '../integrations/supabase/client.js';

async function testPerformance() {
  console.log('=== TEST MEMBER QUERY PERFORMANCE & PAGINATION ===');

  // Test 1: Query users without index / with N+1 simulation (Old pattern)
  console.time('Old Pattern (Fetch all users without pagination)');
  const { data: allUsers } = await supabase
    .from('users')
    .select('id, full_name, username, email, whatsapp, country, province, city, avatar_url, bio, role, ib_region, verification_status, status, locale, created_at')
    .limit(100);
  
  // Simulate N+1: fetching MT5 details one-by-one in loop
  if (allUsers && allUsers.length > 0) {
    for (const u of allUsers.slice(0, 5)) {
      await supabase.from('user_mt5_accounts').select('*').eq('user_id', u.id);
    }
  }
  console.timeEnd('Old Pattern (Fetch all users without pagination)');

  // Test 2: New Pattern (Single Batch Join + Pagination limit 20 + offset)
  console.time('New Pattern (Indexed + Batch Joined + Paginated limit 20)');
  const page = 1;
  const limit = 20;
  const offset = (page - 1) * limit;

  // Single count query
  const countPromise = supabase
    .from('users')
    .select('id', { count: 'exact', head: true });

  // Single range query
  const usersPromise = supabase
    .from('users')
    .select('id, full_name, username, email, whatsapp, country, province, city, avatar_url, bio, role, ib_region, verification_status, status, locale, created_at')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  const [{ count: total }, { data: pagedUsers }] = await Promise.all([countPromise, usersPromise]);

  // Single batch fetch for ALL member MT5 accounts
  if (pagedUsers && pagedUsers.length > 0) {
    const userIds = pagedUsers.map(u => u.id);
    const { data: mt5Accounts } = await supabase
      .from('user_mt5_accounts')
      .select('id, user_id, akun_id, status, conn_status, platform, server, broker, last_connected_at, total_pnl, performance_pct, drawdown_pct, peak_equity')
      .in('user_id', userIds);

    const mt5Map = {};
    for (const acc of mt5Accounts || []) {
      if (!mt5Map[acc.user_id]) mt5Map[acc.user_id] = [];
      mt5Map[acc.user_id].push(acc);
    }

    const enriched = pagedUsers.map(u => ({
      ...u,
      isVerified: u.verification_status === 'verified',
      mt5Accounts: mt5Map[u.id] || [],
      hasMt5: (mt5Map[u.id] || []).length > 0,
      tradingExperience: (mt5Map[u.id] || []).length > 0 ? {
        totalAccounts: mt5Map[u.id].length,
        hasConnectedAccount: mt5Map[u.id].some(a => a.conn_status === 'connected'),
        performancePct: mt5Map[u.id][0]?.performance_pct || 0,
        totalPnl: mt5Map[u.id].reduce((s, a) => s + (Number(a.total_pnl) || 0), 0)
      } : null,
      isOnline: u.status === 'active' && (mt5Map[u.id] || []).some(a => a.conn_status === 'connected')
    }));

    console.log(`Successfully fetched and enriched ${enriched.length} members out of ${total} total.`);
  }

  console.timeEnd('New Pattern (Indexed + Batch Joined + Paginated limit 20)');
  process.exit(0);
}

testPerformance().catch(err => {
  console.error(err);
  process.exit(1);
});
