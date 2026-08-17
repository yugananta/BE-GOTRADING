// BE-GOTRADING/server/scripts/register-vps-account.js
import { supabase } from '../integrations/supabase/client.js';
import { decryptPassword } from '../services/mt5CredentialStore.js';
import { MT5_GATEWAY_URL, MT5_GATEWAY_API_KEY, MT5GW_API_KEY } from '../config/env.js';

const targetLogin = 10056027;

async function run() {
  console.log(`Searching Supabase for account ${targetLogin}...`);
  const { data: row, error } = await supabase
    .from('user_mt5_accounts')
    .select('*')
    .eq('akun_id', targetLogin)
    .maybeSingle();

  if (error) {
    console.error('Error fetching from Supabase:', error);
    process.exit(1);
  }

  if (!row) {
    console.error(`Account ${targetLogin} not found in Supabase.`);
    process.exit(1);
  }

  console.log(`Found account row. ID: ${row.id}, user_id: ${row.user_id}`);
  
  if (!row.password_enc) {
    console.error('Account has no encrypted password stored.');
    process.exit(1);
  }

  const plainPassword = decryptPassword(row.password_enc);
  if (!plainPassword) {
    console.error('Failed to decrypt password.');
    process.exit(1);
  }

  console.log('Successfully decrypted password!');

  const gatewayUrl = `${MT5_GATEWAY_URL}/accounts`;
  console.log(`Sending registration to gateway: ${gatewayUrl}`);

  const apiKey = (MT5_GATEWAY_API_KEY || MT5GW_API_KEY || '').trim();
  const headers = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers['X-API-Key'] = apiKey;
  }

  const payload = {
    login: targetLogin,
    password_investor: plainPassword,
    server: row.server || 'Axi-US50-Demo',
    broker: row.broker || 'Axi',
    user_id: row.user_id,
  };

  try {
    const res = await fetch(gatewayUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    const body = await res.json();
    console.log(`Response Status: ${res.status}`);
    console.log('Response Body:', JSON.stringify(body, null, 2));

    if (res.ok) {
      console.log('Account registered successfully in sync engine!');
    } else {
      console.error('Failed to register account in sync engine.');
    }
  } catch (err) {
    console.error('Error sending request to gateway:', err);
  }
}

run();
