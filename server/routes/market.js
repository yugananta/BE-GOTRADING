// server/routes/market.js
//
// [MOCK] MarketWatchTicker.tsx polling endpoint ini tiap detik untuk
// ticker harga berjalan. Ini PORTING LANGSUNG dari mock generator di
// server.ts AI Studio -- BUKAN feed harga real, hanya angka simulasi
// deterministik berbasis hash+waktu supaya terlihat "hidup" di UI.
// Ganti dengan integrasi feed harga sungguhan (mis. Twelve Data) kalau
// sudah siap -- lihat juga catatan yang sama di routes/analysis.js.

import { Router } from 'express';

const router = Router();

const SYMBOLS = ['XAUUSD', 'BTCUSD', 'OIL', 'EURUSD', 'GBPUSD', 'USDJPY', 'GBPJPY'];
const BASE_PRICES = {
  XAUUSD: 2412.50, BTCUSD: 65230.00, OIL: 82.40,
  EURUSD: 1.0845, GBPUSD: 1.2670, USDJPY: 154.30, GBPJPY: 195.40,
};

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

// Bentuk response HARUS persis { symbol, price (string), change (string
// "+0.45%"), isUp (bool) } -- itu yang langsung dirender MarketWatchTicker.tsx.
function simulateSymbol(symbol, timeBucket) {
  let seed = Math.abs(hashString(symbol) + timeBucket);
  const random = () => {
    seed += 1;
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
  };
  const basePrice = BASE_PRICES[symbol] || 100.0;
  const decimalPlaces = basePrice < 10 ? 4 : 2;
  const fluctuation = (random() - 0.5) * (basePrice * 0.005);
  const currentPrice = basePrice + fluctuation;
  const changePercent = (fluctuation / basePrice) * 100;
  return {
    symbol,
    price: currentPrice.toFixed(decimalPlaces),
    change: `${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%`,
    isUp: changePercent >= 0,
  };
}

router.get('/ticker', (req, res) => {
  const timeBucket = Math.floor(Date.now() / 1000);
  res.json({ success: true, data: SYMBOLS.map((s) => simulateSymbol(s, timeBucket)) });
});

export default router;
