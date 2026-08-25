// server/index.js - entry point

import express from 'express';
import { runMigrations } from './db/migrations.js';
import cors from 'cors';
import { PORT, FRONTEND_URL, ADMIN_FRONTEND_URL } from './config/env.js';
import authRoutes from './routes/auth.js';
import accountRoutes from './routes/accounts.js';
import newsRoutes from './routes/news.js';
import calendarRoutes from './routes/calendar.js';
import communityRoutes from './routes/community.js';
import ibRoutes from './routes/ib.js';
import locationRoutes from './routes/locations.js';
import postRoutes from './routes/posts.js';
import networkRoutes from './routes/network.js';
import messageRoutes from './routes/messages.js';
import notificationRoutes from './routes/notifications.js';
import userRoutes from './routes/users.js';
import adminRoutes from './routes/admin/index.js';
import metatraderRoutes from './routes/metatrader.js';
import storyRoutes from './routes/stories.js';
import groupsRoutes from './routes/groups.js';
import chartsRoutes from './routes/charts.js';
import leaderboardRoutes from './routes/leaderboard.js';
import pwaRoutes from './routes/pwa.js';
import marketRoutes from './routes/market.js';
import analysisRoutes from './routes/analysis.js';
import settingsRoutes from './routes/settings.js';
import metricsRoutes from './routes/metrics.js';   // STEP 14
import { httpMetricsMiddleware } from './middleware/httpMetrics.js'; // STEP 14
import { startReconnectMonitor } from './services/mt5ReconnectService.js'; // MT5 auto-reconnect
import { backfillAllAccountsPerformance } from './services/performanceService.js';

const app = express();

// [FIX] Jaring pengaman terakhir -- kalau ada promise yang error tapi lupa
// di-catch di suatu tempat, LOG saja, jangan biarkan mematikan seluruh
// proses. Ini yang bikin insiden SUPABASE_URL salah kemarin merembet jadi
// crash loop total, padahal harusnya cuma request yang bersangkutan gagal.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Promise Rejection (server tetap jalan):', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception (server tetap jalan):', err);
});

const defaultAllowedOrigins = [
  'https://admin.gotrading.id',
  'https://my.gotrading.id',
  'https://gotrading.id',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:3001',
];

const envOrigins = [FRONTEND_URL, ADMIN_FRONTEND_URL]
  .filter((o) => o && o !== '*')
  .flatMap((o) => o.split(',').map((s) => s.trim()));

const allowedOrigins = Array.from(new Set([...defaultAllowedOrigins, ...envOrigins]));

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      return callback(null, true);
    }
    // Whitelist subdomain gotrading.id, localhost, atau cloud run preview
    if (
      /^https?:\/\/([a-z0-9-]+\.)*gotrading\.id(:[0-9]+)?$/i.test(origin) ||
      /^https?:\/\/([a-z0-9-]+\.)*run\.app(:[0-9]+)?$/i.test(origin) ||
      /^https?:\/\/localhost(:[0-9]+)?$/i.test(origin)
    ) {
      return callback(null, true);
    }
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin', 'X-Total-Count'],
  exposedHeaders: ['X-Total-Count'],
}));
app.use(express.json());
app.use(httpMetricsMiddleware); // STEP 14 — HTTP instrumentation (sebelum semua route)

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// --- API untuk user biasa (app registrasi + community chat) ---
app.use('/api/auth', authRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/news', newsRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/community', communityRoutes);
app.use('/api/ib', ibRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/network', networkRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/users', userRoutes);
app.use('/api/metatrader', metatraderRoutes);
app.use('/api/stories', storyRoutes);
app.use('/api/groups', groupsRoutes);
app.use('/api/charts', chartsRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/pwa', pwaRoutes);
// [MOCK] Lihat komentar di routes/market.js & routes/analysis.js -- data
// simulasi, belum integrasi feed harga/analisa sungguhan.
app.use('/api/market', marketRoutes);
app.use('/api/analysis', analysisRoutes);
app.use('/api/settings', settingsRoutes);

// --- API untuk admin panel (semua route di dalamnya wajib role='admin') ---
app.use('/api/admin', adminRoutes);

// STEP 14 — Prometheus metrics endpoint (tidak perlu auth, akses via private network)
app.use('/metrics', metricsRoutes);

// Health check (tetap tersedia) — semua route pakai next(err) supaya sampai sini.
// [SECURITY] Log full error di server, kembalikan pesan aman ke client.
// Stack trace dan detail internal TIDAK boleh masuk ke response JSON.
app.use((err, req, res, _next) => {
  const status = err.status || 500;
  // Log lengkap hanya di server (untuk debugging), TIDAK dikirim ke client
  if (status >= 500) {
    console.error('[ERROR]', req.method, req.path, err);
  } else {
    console.warn('[WARN]', req.method, req.path, err.message);
  }
  // Response: hanya pesan teks, tanpa stack/internal path
  res.status(status).json({
    error: status < 500
      ? (err.message || 'Request tidak valid')
      : 'Terjadi kesalahan pada server. Silakan coba lagi.',
  });
});

runMigrations().catch((err) => {
  console.error('[MIGRATION] Startup migration failed:', err);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`tarapti-backend jalan di port ${PORT}`);
  // MT5 PERSISTENCE & AUTO-RECONNECT:
  // Setiap kali backend restart/deploy, monitor ini mengambil credential
  // yang tersimpan di database dan menyambungkan ulang akun MT5 secara
  // otomatis -- user TIDAK perlu login ulang ke Axi/MT5.
  startReconnectMonitor();

  // BACKFILL PORTFOLIO PERFORMANCE & DRAWDOWN:
  // Menghitung ulang total_deposit, total_withdrawal, peak_equity, total_pnl,
  // performance_pct, dan drawdown_pct untuk semua akun yang ada di DB.
  backfillAllAccountsPerformance().catch((err) => {
    console.error('[PERF] Automatic performance backfill failed:', err);
  });
});
