// server/scripts/test-active-downline-logic.js
import { listIbs, getIbProfile, getActiveDownlineCount, getIbDownline } from '../services/ibService.js';
import { supabase } from '../integrations/supabase/client.js';

async function runVerification() {
  console.log('=== TEST 1: Baseline Real Users ===');
  const ibs = await listIbs();
  console.log('listIbs count:', ibs.length);
  for (const ib of ibs) {
    console.log(`IB: ${ib.email} | Downlines: ${ib.downlineCount} | Active (MT5): ${ib.activeDownline}`);
  }

  // Pilih 1 user sebagai IB penguji (misalnya yugananta@gmail.com yang belum ada downline)
  const { data: ibUser } = await supabase.from('users').select('*').eq('email', 'yugananta@gmail.com').single();
  console.log('\nSelected IB:', ibUser.email, 'Referral Code:', ibUser.referral_code);

  const originalRole = ibUser.role;
  if (originalRole !== 'ib') {
    await supabase.from('users').update({ role: 'ib' }).eq('id', ibUser.id);
  }

  let profileBefore = await getIbProfile(ibUser.id);
  console.log('Profile BEFORE new referral:', {
    downlineCount: profileBefore.downlineCount,
    activeDownline: profileBefore.activeDownline,
    activeReferrals: profileBefore.activeReferrals,
  });

  // === STEP 2: Daftarkan user referral baru yang BELUM connect MT5 ===
  console.log('\n=== TEST 2: Create referral user WITHOUT MT5 account ===');
  const testUserId = '00000000-0000-4000-a000-000000000099';
  await supabase.from('user_mt5_accounts').delete().eq('user_id', testUserId);
  await supabase.from('users').delete().eq('id', testUserId);

  const { data: newUser, error: createErr } = await supabase.from('users').insert({
    id: testUserId,
    email: 'test_referral_no_mt5@example.com',
    password_hash: 'dummy_hash_for_test',
    referred_by: ibUser.id,
    role: 'user',
    status: 'active', // Akun user active secara umum
    referral_code: 'TEST-NO-MT5'
  }).select().single();

  if (createErr) {
    console.error('Create error:', createErr);
    return;
  }

  const profileWithUnconnectedUser = await getIbProfile(ibUser.id);
  const downlineList = await getIbDownline(ibUser.id);
  const ibListAfterRegister = await listIbs();
  const targetIbInList = ibListAfterRegister.find(i => i.id === ibUser.id);

  console.log('Profile AFTER register (NO MT5):', {
    downlineCount: profileWithUnconnectedUser.downlineCount,
    activeDownline: profileWithUnconnectedUser.activeDownline,
    activeReferrals: profileWithUnconnectedUser.activeReferrals,
  });
  console.log('listIbs entry (NO MT5):', {
    downlineCount: targetIbInList.downlineCount,
    activeDownline: targetIbInList.activeDownline,
  });
  console.log('getIbDownline entry (NO MT5):', downlineList);

  const test2Passed = profileWithUnconnectedUser.downlineCount === 1 &&
                      profileWithUnconnectedUser.activeDownline === 0 &&
                      targetIbInList.activeDownline === 0 &&
                      downlineList[0]?.is_mt5_connected === false;
  console.log('--> TEST 2 (Unconnected user is NOT active):', test2Passed ? 'PASSED ✅' : 'FAILED ❌');

  // === STEP 3: Hubungkan Akun MT5 untuk user tersebut ===
  console.log('\n=== TEST 3: Connect MT5 account for referral user ===');
  const { data: mt5Row, error: mt5Err } = await supabase.from('user_mt5_accounts').insert({
    user_id: testUserId,
    akun_id: 99999999,
    status: 'connected',
    conn_status: 'connected'
  }).select().single();

  if (mt5Err) console.error('MT5 insert error:', mt5Err);

  const profileWithConnectedUser = await getIbProfile(ibUser.id);
  const downlineListAfterMT5 = await getIbDownline(ibUser.id);
  const ibListAfterMT5 = await listIbs();
  const targetIbInListAfterMT5 = ibListAfterMT5.find(i => i.id === ibUser.id);

  console.log('Profile AFTER connect MT5:', {
    downlineCount: profileWithConnectedUser.downlineCount,
    activeDownline: profileWithConnectedUser.activeDownline,
    activeReferrals: profileWithConnectedUser.activeReferrals,
  });
  console.log('listIbs entry (WITH MT5):', {
    downlineCount: targetIbInListAfterMT5.downlineCount,
    activeDownline: targetIbInListAfterMT5.activeDownline,
  });
  console.log('getIbDownline entry (WITH MT5):', downlineListAfterMT5);

  const test3Passed = profileWithConnectedUser.downlineCount === 1 &&
                      profileWithConnectedUser.activeDownline === 1 &&
                      targetIbInListAfterMT5.activeDownline === 1 &&
                      downlineListAfterMT5[0]?.is_mt5_connected === true;
  console.log('--> TEST 3 (Connected user IS active):', test3Passed ? 'PASSED ✅' : 'FAILED ❌');

  // === STEP 4: Cleanup Data Test ===
  console.log('\n=== STEP 4: Cleaning up test data ===');
  await supabase.from('user_mt5_accounts').delete().eq('user_id', testUserId);
  await supabase.from('users').delete().eq('id', testUserId);
  if (originalRole !== 'ib') {
    await supabase.from('users').update({ role: originalRole }).eq('id', ibUser.id);
  }
  console.log('Cleanup completed successfully!');
}

runVerification();
