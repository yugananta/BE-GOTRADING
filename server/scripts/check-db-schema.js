import { supabase } from '../integrations/supabase/client.js';

async function checkDatabase() {
  console.log('=== CHECKING EXISTING TABLES AND DATA ===');

  // Check users table
  const { data: users, error: usersErr } = await supabase.from('users').select('*').limit(5);
  console.log('Users table check:', usersErr ? usersErr.message : `Found ${users.length} sample users`);
  if (users && users.length > 0) {
    console.log('Sample user keys:', Object.keys(users[0]));
    const referredCount = users.filter(u => u.referred_by).length;
    console.log(`Users with referred_by: ${referredCount}`);
  }

  // Check transactions table
  const { data: tx, error: txErr } = await supabase.from('transactions').select('*').limit(5);
  console.log('Transactions table check:', txErr ? txErr.message : `Found ${tx?.length || 0} transactions`);
  if (tx && tx.length > 0) {
    console.log('Sample transaction keys:', Object.keys(tx[0]));
  }

  // Check if profiles table exists
  const { data: profiles, error: profErr } = await supabase.from('profiles').select('*').limit(5);
  console.log('Profiles table check:', profErr ? profErr.message : `Found ${profiles?.length || 0} profiles`);

  process.exit(0);
}

checkDatabase();
