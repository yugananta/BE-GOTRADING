// server/services/calendarService.js
//
// Economic calendar -- di-cache 6 jam (data kalender ekonomi tidak
// berubah sesering berita biasa). Kalau fetchEconomicCalendar() gagal
// 403 (kemungkinan perlu premium di akun Finnhub kamu), otomatis
// fallback ke earnings calendar supaya endpoint tetap balikin sesuatu
// yang berguna, bukan error kosong.

import { supabase } from '../integrations/supabase/client.js';
import { fetchEconomicCalendar, fetchEarningsCalendar, NewsApiError } from '../integrations/news/client.js';

const CACHE_TTL_MINUTES = 360; // 6 jam

export async function getCalendar() {
  const { data: cached } = await supabase
    .from('news_cache')
    .select('*')
    .eq('cache_key', 'economic_calendar')
    .order('fetched_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const isStale =
    !cached ||
    Date.now() - new Date(cached.fetched_at).getTime() > CACHE_TTL_MINUTES * 60 * 1000;

  if (!isStale) {
    return cached.payload;
  }

  let fresh;
  let source = 'economic';
  try {
    fresh = await fetchEconomicCalendar();
  } catch (err) {
    if (err instanceof NewsApiError && err.status === 403) {
      // Akun Finnhub tidak punya akses ke economic calendar -- fallback.
      const today = new Date().toISOString().slice(0, 10);
      const in30Days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      fresh = await fetchEarningsCalendar(today, in30Days);
      source = 'earnings_fallback';
    } else {
      throw err;
    }
  }

  const payload = { source, data: fresh };

  await supabase
    .from('news_cache')
    .insert({ cache_key: 'economic_calendar', payload, fetched_at: new Date().toISOString() });

  return payload;
}
