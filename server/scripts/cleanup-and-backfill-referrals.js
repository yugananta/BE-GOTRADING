import { supabase } from '../integrations/supabase/client.js';
import { listIbs } from '../services/ibService.js';

async function execute() {
  console.log('=== STEP 1: HAPUS AKUN TEST ===');
  const testEmail = 'test_ai_agent_unique_998@example.com';
  
  // Find test user
  const { data: testUsers } = await supabase.from('users').select('id, email').eq('email', testEmail);
  console.log('Found test users:', testUsers);
  
  if (testUsers && testUsers.length > 0) {
    const testId = testUsers[0].id;
    // Check related tables
    const { data: mt5 } = await supabase.from('user_mt5_accounts').select('id').eq('user_id', testId);
    console.log('Related user_mt5_accounts:', mt5);
    if (mt5 && mt5.length > 0) {
      await supabase.from('user_mt5_accounts').delete().eq('user_id', testId);
    }
    
    // Delete from users
    const { error: delErr } = await supabase.from('users').delete().eq('id', testId);
    if (delErr) {
      console.error('Error deleting test user:', delErr);
    } else {
      console.log('Successfully deleted test user:', testEmail);
    }
  }

  // Check remaining users
  const { data: remainingUsers } = await supabase.from('users').select('id, email, role, referral_code, referred_by');
  console.log('Total remaining users count:', remainingUsers?.length);

  console.log('\n=== STEP 2: BACKFILL referral_code UNTUK 5 USER ASLI ===');
  for (const user of (remainingUsers || [])) {
    const code = 'TARAPTI-' + user.id.slice(0, 6).toUpperCase();
    console.log(`Updating ${user.email} (ID: ${user.id}) -> referral_code: ${code}`);
    
    const { error: upErr } = await supabase
      .from('users')
      .update({ referral_code: code })
      .eq('id', user.id);
      
    if (upErr) {
      console.error(`Error updating ${user.email}:`, upErr);
    }
  }

  // Verify updated users
  const { data: updatedUsers } = await supabase.from('users').select('id, email, role, referral_code, referred_by, status');
  console.log('\n=== VERIFIKASI TABEL USERS SETELAH BACKFILL ===');
  console.log(JSON.stringify(updatedUsers, null, 2));

  // Verify listIbs()
  const ibs = await listIbs();
  console.log('\n=== VERIFIKASI HASIL listIbs() / (/api/admin/ib) ===');
  console.log('Total partners returned:', ibs.length);
  console.log(JSON.stringify(ibs, null, 2));
}

execute()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
