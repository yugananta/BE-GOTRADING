import { supabase } from '../integrations/supabase/client.js';

async function inspectProfilesAndUsers() {
  const { data: users } = await supabase.from('users').select('*').limit(2);
  const { data: profiles } = await supabase.from('profiles').select('*').limit(2);
  console.log('Users:', users);
  console.log('Profiles:', profiles);
  process.exit(0);
}
inspectProfilesAndUsers();
