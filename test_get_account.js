import { getMyAccount } from './server/services/metatraderService.js';
import { supabase } from './server/integrations/supabase/client.js';
import 'dotenv/config';

async function run() {
  const userId = '13ecaf22-7f34-4430-9750-2a74d79c910a';
  console.log(`Querying user_mt5_accounts directly for user: ${userId}`);
  try {
    const { data, error } = await supabase
      .from('user_mt5_accounts')
      .select('*')
      .eq('user_id', userId);
    console.log('Direct Data:', data);
    
    console.log('Calling getMyAccount...');
    const res = await getMyAccount(userId);
    console.log('getMyAccount Result:', JSON.stringify(res, null, 2));
  } catch (err) {
    console.error('Failed:', err);
  }
}

run();
