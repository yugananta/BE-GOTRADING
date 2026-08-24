import { supabase } from '../integrations/supabase/client.js';

async function listAllTables() {
  const { data, error } = await supabase.rpc('get_tables_list').select('*'); // or query via rpc if available, or direct query
  // Since we don't have rpc, let's query a known table or run a query if supabase allows, or test common tables.
  const tablesToCheck = ['users', 'user_mt5_accounts', 'profiles', 'transactions', 'ib_commissions', 'ib_commission_tiers', 'commissions', 'payouts'];
  for (const t of tablesToCheck) {
    const { data, error } = await supabase.from(t).select('*').limit(1);
    console.log(`Table '${t}':`, error ? `NOT FOUND (${error.message})` : `EXISTS (${data.length} rows sample)`);
  }
  process.exit(0);
}

listAllTables();
