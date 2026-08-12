// server/services/adminSettingsService.js
//
// Pengaturan integrasi global yang diedit dari AdminPortal.tsx (server MT5
// default, provider berita, Telegram, FCM). Satu baris singleton
// (admin_settings, id=1) -- lihat sql/09_admin_settings.sql.

import { supabase } from '../integrations/supabase/client.js';
import { MT5_GATEWAY_URL, MT5GW_API_KEY } from '../config/env.js';

const COLUMN_MAP = {
  mt5Server: 'mt5_server',
  mt5Login: 'mt5_login',
  mt5Password: 'mt5_password',
  mt5Port: 'mt5_port',
  mt5Status: 'mt5_status',
  newsProvider: 'news_provider',
  newsRssUrl: 'news_rss_url',
  newsApiKey: 'news_api_key',
  telegramBotToken: 'telegram_bot_token',
  telegramChatId: 'telegram_chat_id',
  fcmServerKey: 'fcm_server_key',
};

function toCamel(row) {
  const out = {};
  for (const [camel, col] of Object.entries(COLUMN_MAP)) out[camel] = row[col];
  return out;
}

export async function getSettings() {
  const { data, error } = await supabase.from('admin_settings').select('*').eq('id', 1).maybeSingle();
  if (error) throw error;
  return data ? toCamel(data) : {};
}

export async function saveSettings(body) {
  const patch = { updated_at: new Date().toISOString() };
  for (const [camel, col] of Object.entries(COLUMN_MAP)) {
    if (body[camel] !== undefined) patch[col] = body[camel];
  }
  const { data, error } = await supabase.from('admin_settings').update(patch).eq('id', 1).select().single();
  if (error) throw error;
  return toCamel(data);
}

// [CATATAN] MT5 Gateway (app.py) sudah punya endpoint /health publik --
// yang dites di sini adalah KETERJANGKAUAN JARINGAN + status koneksi MT5.
export async function testMt5Connection() {
  try {
    const res = await fetch(`${MT5_GATEWAY_URL}/health`, {
      headers: { 'x-api-key': MT5GW_API_KEY },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 401) {
      const err = new Error('MT5GW_API_KEY salah -- gateway menolak API key ini');
      err.status = 502;
      throw err;
    }
    if (!res.ok) {
      const err = new Error(`MT5 Gateway mengembalikan status ${res.status}`);
      err.status = 502;
      throw err;
    }
    const data = await res.json();
    return {
      message: 'MT5 Gateway terjangkau dan terhubung ke MT5.',
      status: data.status,
      broker: data.broker,
      login: data.login,
      server: data.server,
    };
  } catch (err) {
    if (err.status) throw err;
    const wrapped = new Error('Tidak bisa menghubungi MT5 Gateway. Cek MT5_GATEWAY_URL dan pastikan VPS/app.py sedang berjalan.');
    wrapped.status = 502;
    throw wrapped;
  }
}
