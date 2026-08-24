// server/services/priceService.js
//
// Outlook.tsx (LivePriceChart) polling GET /api/charts/prices?pair=...
// setiap 60 detik, mengharapkan { success, currentPrice, points: [...] }.
//
// [KETERBATASAN] Finnhub free tier TIDAK menyediakan candle historis untuk
// forex (perlu paket premium) -- hanya /quote (harga real-time) yang
// gratis. Jadi endpoint ini membangun "points" dari histori quote yang
// di-cache di memori server sendiri (nambah 1 titik setiap kali endpoint
// ini dipanggil), bukan dari candle historis asli. Cukup untuk chart yang
// bergerak live selama server hidup, TAPI riwayatnya reset tiap restart
// server dan tidak akurat sebagai OHLC historis. Kalau butuh candle
// historis yang benar, ganti sumber data ke provider forex khusus
// (mis. Polygon.io, TwelveData) yang punya free tier candle forex.

import { NEWS_API_KEY } from '../config/env.js';

const MAX_POINTS = 60;
const pointsCache = new Map(); // pair -> [{time, price, open, high, low, changePercent}]

// TradingView-style symbol ("OANDA:XAUUSD") -> simbol Finnhub.
// Finnhub crypto (BINANCE:BTCUSDT) dipakai apa adanya. Finnhub forex
// pakai format "OANDA:EUR_USD" (underscore).
function toFinnhubSymbol(pair) {
  if (pair.startsWith('BINANCE:')) return pair;
  const m = pair.match(/^OANDA:([A-Z]{3})([A-Z]{3,4})$/);
  if (m) return `OANDA:${m[1]}_${m[2]}`;
  return pair;
}

export async function getPriceSeries(pair) {
  if (!NEWS_API_KEY) {
    const err = new Error('NEWS_API_KEY (dipakai juga untuk harga via Finnhub) belum diisi di .env');
    err.status = 500;
    throw err;
  }
  const symbol = toFinnhubSymbol(pair);
  const url = new URL('https://finnhub.io/api/v1/quote');
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('token', NEWS_API_KEY);

  const res = await fetch(url);
  if (!res.ok) {
    const err = new Error(`Finnhub quote error (HTTP ${res.status}) untuk ${symbol}`);
    err.status = 502;
    throw err;
  }
  const q = await res.json();
  // Finnhub /quote: c=current, o=open, h=high, l=low, pc=previous close
  if (!q || typeof q.c !== 'number' || q.c === 0) {
    const err = new Error(`Simbol ${symbol} tidak dikenali Finnhub atau tidak ada data`);
    err.status = 404;
    throw err;
  }

  const changePercent = q.pc ? ((q.c - q.pc) / q.pc) * 100 : 0;
  const point = {
    time: new Date().toISOString(),
    price: q.c,
    open: q.o,
    high: q.h,
    low: q.l,
    changePercent: Number(changePercent.toFixed(3)),
  };

  const series = pointsCache.get(pair) || [];
  series.push(point);
  if (series.length > MAX_POINTS) series.shift();
  pointsCache.set(pair, series);

  return { success: true, currentPrice: q.c, points: series };
}
