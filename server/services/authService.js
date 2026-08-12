// server/services/authService.js
//
// Registrasi, login, dan refresh token JWT custom. Password di-hash
// dengan bcrypt, TIDAK PERNAH disimpan plain text. `role` disertakan
// di access token payload supaya requireAdmin bisa cek tanpa hit DB
// di setiap request.

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { supabase } from '../integrations/supabase/client.js';
import { JWT_ACCESS_SECRET, JWT_REFRESH_SECRET } from '../config/env.js';
import { resolveReferralCode, ensureReferralCode } from './ibService.js';

const ACCESS_TOKEN_TTL = '30d';
const REFRESH_TOKEN_TTL = '30d';

function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role || 'user' },
    JWT_ACCESS_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL }
  );
}

function signRefreshToken(user) {
  return jwt.sign({ sub: user.id }, JWT_REFRESH_SECRET, { expiresIn: REFRESH_TOKEN_TTL });
}

export async function registerUser({ email, password, fullName, username, country, province, city, whatsapp, referredBy, referralCode }) {
  if (!email || !password) {
    const err = new Error('Email dan password wajib diisi');
    err.status = 400;
    throw err;
  }

  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  if (existing) {
    const err = new Error('Email sudah terdaftar');
    err.status = 409;
    throw err;
  }

  // Referral bisa datang dari link (?ref=KODE) yang diteruskan sebagai
  // referralCode, atau (untuk kompatibilitas lama) langsung UUID di
  // referredBy. Kode referral yang lebih diutamakan kalau dua-duanya ada.
  let resolvedReferrer = referredBy || null;
  if (referralCode) {
    const referrerId = await resolveReferralCode(referralCode);
    if (!referrerId) {
      const err = new Error('Kode referral tidak ditemukan');
      err.status = 400;
      throw err;
    }
    resolvedReferrer = referrerId;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const { data: user, error } = await supabase
    .from('users')
    .insert({
      email, password_hash: passwordHash, full_name: fullName, username, country, province, city, whatsapp,
      referred_by: resolvedReferrer,
    })
    .select('id, email, full_name, username, role')
    .single();

  if (error) throw error;

  // Setiap user dapat kode referral sendiri sejak awal -- kalau nanti
  // dipromosikan jadi IB (role='ib'), link referral-nya sudah siap dipakai
  // tanpa perlu langkah tambahan.
  const ownReferralCode = await ensureReferralCode(user.id);

  return {
    user: { ...user, referralCode: ownReferralCode },
    accessToken: signAccessToken(user),
    refreshToken: signRefreshToken(user),
  };
}

export async function loginUser({ email, password }) {
  const { data: user, error } = await supabase
    .from('users')
    .select('id, email, password_hash, role, status, verification_status')
    .eq('email', email)
    .maybeSingle();

  if (error) throw error;

  if (!user) {
    const err = new Error('Email atau password salah');
    err.status = 401;
    throw err;
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    const err = new Error('Email atau password salah');
    err.status = 401;
    throw err;
  }

  if (user.status === 'suspended') {
    const err = new Error('Akun ini telah di-suspend. Hubungi admin.');
    err.status = 403;
    throw err;
  }

  return {
    user: { id: user.id, email: user.email, role: user.role, isVerified: user.verification_status === 'verified' },
    accessToken: signAccessToken(user),
    refreshToken: signRefreshToken(user),
  };
}

export function refreshAccessToken(refreshToken) {
  if (!refreshToken) {
    const err = new Error('Refresh token wajib dikirim');
    err.status = 400;
    throw err;
  }
  let payload;
  try {
    payload = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
  } catch {
    const err = new Error('Refresh token tidak valid atau kedaluwarsa');
    err.status = 401;
    throw err;
  }
  // Ambil role terbaru dari DB (bukan dari token lama) supaya kalau role
  // berubah setelah refresh token diterbitkan, access token baru tetap akurat.
  return getUserById(payload.sub).then((user) => signAccessToken(user));
}

export async function getUserById(id) {
  const { data: user, error } = await supabase
    .from('users')
    .select('id, email, role, verification_status')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!user) {
    const err = new Error('User tidak ditemukan');
    err.status = 404;
    throw err;
  }
  return {
    ...user,
    isVerified: user.verification_status === 'verified'
  };
}

export function verifyAccessToken(token) {
  return jwt.verify(token, JWT_ACCESS_SECRET);
}

// Dipakai Auth.tsx saat registrasi (real-time check sebelum submit).
export async function checkAvailability({ email, username }) {
  const result = {};
  if (email) {
    const { data } = await supabase.from('users').select('id').eq('email', email).maybeSingle();
    result.emailAvailable = !data;
  }
  if (username) {
    const { data } = await supabase.from('users').select('id').eq('username', username).maybeSingle();
    result.usernameAvailable = !data;
  }
  return result;
}

// [CATATAN] Belum ada provider email terpasang (SendGrid/Resend/dst).
// Untuk sekarang, link reset di-log ke console server supaya tim masih
// bisa uji alur ini secara manual. Tambahkan integrations/email/client.js
// begitu provider dipilih, lalu panggil dari sini -- request/response
// endpoint (routes/auth.js) TIDAK perlu berubah.
export async function requestPasswordReset(email) {
  const { data: user } = await supabase.from('users').select('id, email').eq('email', email).maybeSingle();

  // Selalu balas sukses walau email tidak ditemukan -- mencegah orang lain
  // menebak email mana saja yang terdaftar (enumeration attack).
  if (!user) return { success: true };

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 jam

  const { error } = await supabase
    .from('password_resets')
    .insert({ user_id: user.id, token_hash: tokenHash, expires_at: expiresAt.toISOString() });
  if (error) throw error;

  // [SECURITY] Token hanya dikirim via email, JANGAN log token mentah.
  // Uncomment console di bawah ini HANYA saat debug lokal, JANGAN di production.
  // console.log(`[password-reset] Link: /reset-password?token=${rawToken}`);
  console.log(`[password-reset] Token digenerate untuk ${email} (token TIDAK dilog untuk keamanan).`);

  return { success: true };
}

export async function resetPassword(rawToken, newPassword) {
  if (!rawToken || !newPassword) {
    const err = new Error('Token dan password baru wajib diisi');
    err.status = 400;
    throw err;
  }
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  const { data: resetRow, error } = await supabase
    .from('password_resets')
    .select('id, user_id, expires_at, used_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();
  if (error) throw error;

  if (!resetRow || resetRow.used_at || new Date(resetRow.expires_at) < new Date()) {
    const err = new Error('Token reset tidak valid atau sudah kedaluwarsa');
    err.status = 400;
    throw err;
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  const { error: updateError } = await supabase.from('users').update({ password_hash: passwordHash }).eq('id', resetRow.user_id);
  if (updateError) throw updateError;

  await supabase.from('password_resets').update({ used_at: new Date().toISOString() }).eq('id', resetRow.id);

  return { success: true };
}
