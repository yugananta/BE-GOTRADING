// server/routes/analysis.js
//
// [MOCK / PLACEHOLDER] TechnicalAnalysis.tsx panggil /sync lalu
// /sentiment/:symbol untuk menampilkan sentimen & indikator teknikal.
// Ini PORTING LANGSUNG dari mock generator di server.ts AI Studio --
// angka RANDOM, bukan hasil perhitungan indikator sungguhan (EMA/RSI/
// MACD real) dan bukan hasil AI. Simpan di memori proses saja (Map),
// jadi reset tiap restart/deploy dan TIDAK sinkron antar instance kalau
// backend di-scale >1 replika.
//
// Ini scope BERBEDA dari rencana "signal trading intraday XAUUSD berbasis
// liquidity sweep" yang sudah didiskusikan terpisah -- itu perlu data
// engine sungguhan (mis. Twelve Data + rule engine), belum diimplementasi
// di sini. Ganti isi generateMockAnalysis() dengan logic itu nanti.

import { Router } from 'express';

// Sengaja TIDAK dipasangi requireAuth -- di server.ts AI Studio pun kedua
// endpoint ini publik (samakan perilaku, konsisten dengan /api/market/ticker).
const router = Router();

const mockStore = new Map();

function generateMockAnalysis(symbol) {
  const basePrice = symbol.includes('XAUUSD') ? 2350 : 1.08;
  const indicators = {
    ema20: basePrice * (1 + (Math.random() * 0.002 - 0.001)),
    ema50: basePrice * (1 + (Math.random() * 0.004 - 0.002)),
    ema200: basePrice * (1 + (Math.random() * 0.01 - 0.005)),
    rsi: 30 + Math.random() * 40,
    macd: (Math.random() * 2 - 1).toFixed(4),
    adx: 15 + Math.random() * 30,
    vwap: basePrice,
    atr: (basePrice * 0.002).toFixed(4),
    support: (basePrice * 0.995).toFixed(4),
    resistance: (basePrice * 1.005).toFixed(4),
  };
  const isBullish = indicators.rsi > 50 && indicators.ema20 > indicators.ema50;
  const sentiment = {
    sentiment: isBullish ? (indicators.rsi > 70 ? 'Strong Bullish' : 'Bullish') : (indicators.rsi < 30 ? 'Strong Bearish' : 'Bearish'),
    confidence: Math.floor(60 + Math.random() * 35),
    technicalScore: Math.floor(40 + Math.random() * 50),
    trendStrength: indicators.adx > 25 ? 'Strong' : 'Weak',
    riskLevel: Number(indicators.atr) > 5 ? 'High' : 'Medium',
    signal: isBullish ? 'Potential Buy' : 'Potential Sell',
    aiExplanation: `Berdasarkan data terakhir, ${symbol} menunjukkan struktur ${isBullish ? 'bullish' : 'bearish'}. Harga ${isBullish ? 'di atas' : 'di bawah'} EMA 50, dan RSI mengindikasikan momentum ${isBullish ? 'naik' : 'turun'}. Support terdekat di ${indicators.support}, resistance di ${indicators.resistance}.`,
    updatedAt: new Date().toISOString(),
  };
  return { sentiment, indicators };
}

router.post('/sync', (req, res) => {
  const { symbol } = req.body;
  if (!symbol) return res.status(400).json({ error: 'Symbol required' });
  mockStore.set(symbol, generateMockAnalysis(symbol));
  res.json({ success: true, message: 'Sync complete' });
});

router.get('/sentiment/:symbol', (req, res) => {
  const { symbol } = req.params;
  if (!mockStore.has(symbol)) mockStore.set(symbol, generateMockAnalysis(symbol));
  res.json({ success: true, ...mockStore.get(symbol) });
});

export default router;
