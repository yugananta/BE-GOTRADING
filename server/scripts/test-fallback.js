import { listMyNotifications } from '../services/notificationService.js';
import { supabase } from '../integrations/supabase/client.js';

async function run() {
  // Mock supabase query to fail
  const originalFrom = supabase.from;
  supabase.from = (table) => {
    return {
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: async () => ({ error: new Error('Simulated Supabase DB Timeout') })
          })
        })
      })
    };
  };

  const res = await listMyNotifications('dummy-user-id');
  console.log(JSON.stringify(res, null, 2));
  process.exit(0);
}
run();
