// server/integrations/news/client.js
//
// Client tipis untuk Finnhub News API (finnhub.io). Free tier: 60
// request/menit, tidak perlu kartu kredit. Endpoint yang dipakai:
// /news (berita pasar umum) dan /company-news (berita per simbol).

import { NEWS_API_KEY, NEWS_BASE_URL } from '../../config/env.js';

const BASE_URL = NEWS_BASE_URL || 'https://finnhub.io/api/v1';

export class NewsApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'NewsApiError';
    this.status = status;
  }
}

async function request(path, params = {}) {
  if (!NEWS_API_KEY) {
    throw new NewsApiError('NEWS_API_KEY belum diisi di .env', 500);
  }

  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set('token', NEWS_API_KEY);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  }

  const res = await fetch(url);
  if (!res.ok) {
    throw new NewsApiError(`Finnhub error (HTTP ${res.status})`, res.status);
  }
  return res.json();
}

// Berita pasar umum. category: 'general' | 'forex' | 'crypto' | 'merger'
export function fetchNews(category = 'forex') {
  return request('/news', { category });
}

// Berita spesifik per simbol (mis. 'EURUSD', 'AAPL'), dengan rentang tanggal
export function fetchCompanyNews(symbol, fromDate, toDate) {
  return request('/company-news', { symbol, from: fromDate, to: toDate });
}

// Economic calendar (rilis data ekonomi: NFP, suku bunga, inflasi, dst).
// CATATAN: belum dipastikan gratis di semua akun Finnhub -- beberapa
// endpoint kalender di Finnhub memerlukan paket premium. Coba dulu
// dengan API key kamu; kalau dapat 403, endpoint ini perlu upgrade,
// dan bisa diganti pakai fetchEarningsCalendar() di bawah (dipastikan
// ada di free tier) sebagai gantinya.
export function fetchEconomicCalendar() {
  return request('/calendar/economic', {});
}

// Earnings calendar (jadwal rilis laporan keuangan perusahaan) --
// dipastikan tersedia di free tier Finnhub, alternatif kalau
// economic calendar ternyata perlu premium.
export function fetchEarningsCalendar(fromDate, toDate) {
  return request('/calendar/earnings', { from: fromDate, to: toDate });
}
