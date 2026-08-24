import { supabase } from '../integrations/supabase/client.js';

async function checkIbCommissions() {
  const { data, error } = await supabase.from('ib_commissions').select('*').limit(5);
  console.log('ib_commissions:', data, error);
  process.exit(0);
}
checkIbCommissions();
