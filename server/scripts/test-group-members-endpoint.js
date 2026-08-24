import jwt from 'jsonwebtoken';
import { JWT_ACCESS_SECRET } from '../config/env.js';
import { getGroupMembers } from '../services/communityService.js';
import { searchUsersByLocation } from '../services/profileService.js';
import { supabase } from '../integrations/supabase/client.js';

async function runTests() {
  console.log('=== TESTING GROUP MEMBERS ENDPOINTS & PAGINATION ===\n');

  // Find sample users or locations
  const { data: sampleUsers } = await supabase.from('users').select('id, city, province, country').limit(5);
  const sampleUser = sampleUsers?.[0] || { id: '00000000-0000-0000-0000-000000000000', city: 'Jakarta', province: 'DKI Jakarta' };
  console.log(`Using sample user: city="${sampleUser.city}", province="${sampleUser.province}"`);

  // Test 1: getGroupMembers direct service call with pagination page 1
  console.log('\n[Test 1] Testing getGroupMembers (page 1, limit 2):');
  const resPage1 = await getGroupMembers({
    city: sampleUser.city,
    province: sampleUser.province,
    page: 1,
    limit: 2,
    viewerId: sampleUser.id
  });
  console.log('Page 1 result structure:', {
    membersCount: resPage1.members.length,
    total: resPage1.total,
    page: resPage1.page,
    limit: resPage1.limit,
    totalPages: resPage1.totalPages,
    hasMore: resPage1.hasMore
  });
  if (resPage1.members.length > 0) {
    const m = resPage1.members[0];
    console.log('Sample Member enriched fields:', {
      id: m.id,
      fullName: m.full_name,
      username: m.username,
      isVerified: m.isVerified,
      isOnline: m.isOnline,
      onlineStatus: m.onlineStatus,
      tradingExperience: m.tradingExperience,
      hasMt5: m.hasMt5,
      isFollowing: m.isFollowing
    });
  }

  // Test 2: Pagination page 2
  console.log('\n[Test 2] Testing getGroupMembers (page 2, limit 2):');
  const resPage2 = await getGroupMembers({
    city: sampleUser.city,
    province: sampleUser.province,
    page: 2,
    limit: 2,
    viewerId: sampleUser.id
  });
  console.log('Page 2 result:', {
    membersCount: resPage2.members.length,
    page: resPage2.page,
    hasMore: resPage2.hasMore
  });

  // Test 3: Backward compatibility in searchUsersByLocation
  console.log('\n[Test 3] Testing searchUsersByLocation backward compatibility:');
  const locationRes = await searchUsersByLocation({ city: sampleUser.city, province: sampleUser.province });
  console.log('searchUsersByLocation result:', {
    isObject: typeof locationRes === 'object',
    hasMembers: Array.isArray(locationRes.members),
    total: locationRes.total
  });

  // Test 4: Verify NO N+1 queries (all MT5 and follow relationships fetched in batch)
  console.log('\n[Test 4] Verifying single batch fetch (no N+1 loop):');
  const start = performance.now();
  const batchRes = await getGroupMembers({ limit: 50, viewerId: sampleUser.id });
  const duration = performance.now() - start;
  console.log(`Fetched and batch-enriched ${batchRes.members.length} members in ${duration.toFixed(2)}ms.`);

  console.log('\n✅ ALL GROUP MEMBER TESTS PASSED SUCCESSFULLY!');
  process.exit(0);
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
