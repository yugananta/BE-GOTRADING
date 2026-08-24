// server/services/newsService.js
//
// News untuk end-user, pakai Finnhub (integrations/news/client.js) +
// cache di Supabase supaya tidak boros kuota (Finnhub free tier: 60
// request/menit -- kalau tiap user buka app langsung hit Finnhub,
// kuota jebol saat user makin banyak).

import { supabase } from '../integrations/supabase/client.js';
import { fetchNews } from '../integrations/news/client.js';

const CACHE_TTL_MINUTES = 30;

export async function getLatestNews() {
  const { data: cached } = await supabase
    .from('news_cache')
    .select('*')
    .eq('cache_key', 'news')
    .order('fetched_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const isStale =
    !cached ||
    Date.now() - new Date(cached.fetched_at).getTime() > CACHE_TTL_MINUTES * 60 * 1000;

  if (!isStale) {
    return cached.payload;
  }

  return refreshNewsCache();
}

// Dipanggil admin (AdminPortal.tsx: "Sync News") untuk paksa ambil ulang
// dari Finnhub sekarang juga, tidak menunggu cache 30 menit kedaluwarsa.
export async function refreshNewsCache() {
  const fresh = await fetchNews('forex');
  await supabase
    .from('news_cache')
    .insert({ cache_key: 'news', payload: fresh, fetched_at: new Date().toISOString() });
  return fresh;
}
