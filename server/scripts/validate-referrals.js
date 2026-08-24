import { supabase } from '../integrations/supabase/client.js';

async function validateUsersData() {
  console.log('=== RUNNING PRE-MIGRATION VALIDATION CHECKS ===');

  const { data: users, error } = await supabase.from('users').select('id, email, referral_code, referred_by');
  if (error) {
    console.error('Error fetching users:', error.message);
    process.exit(1);
  }

  console.log(`Total users fetched: ${users.length}`);

  // 1. Check duplicate referral_code
  const codeCounts = {};
  users.forEach(u => {
    if (u.referral_code) {
      codeCounts[u.referral_code] = (codeCounts[u.referral_code] || 0) + 1;
    }
  });
  const duplicates = Object.entries(codeCounts).filter(([code, count]) => count > 1);
  console.log(`1. Duplicate referral_code check: ${duplicates.length} duplicate(s) found.`);
  if (duplicates.length > 0) {
    console.log('Duplicate codes:', duplicates);
  }

  // 2. Check empty or null referral_code
  const emptyCodes = users.filter(u => !u.referral_code || u.referral_code.trim() === '');
  console.log(`2. Empty/Null referral_code check: ${emptyCodes.length} user(s) found.`);
  if (emptyCodes.length > 0) {
    console.log('Users with empty referral_code:', emptyCodes.map(u => ({ id: u.id, email: u.email })));
  }

  // 3. Check self-referral (referred_by = id)
  const selfReferrals = users.filter(u => u.referred_by && u.referred_by === u.id);
  console.log(`3. Self-referral check: ${selfReferrals.length} user(s) found.`);
  if (selfReferrals.length > 0) {
    console.log('Users with self-referral:', selfReferrals.map(u => ({ id: u.id, email: u.email })));
  }

  console.log('=== VALIDATION COMPLETE ===');
  process.exit(0);
}

validateUsersData();
