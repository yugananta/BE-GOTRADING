// server/services/profileService.js
import { supabase } from '../integrations/supabase/client.js';

const PUBLIC_FIELDS = 'id, full_name, username, email, whatsapp, country, province, city, avatar_url, bio, role, ib_region, verification_status, status, locale, created_at';

export async function getProfile(userId) {
  const { data, error } = await supabase.from('users').select(PUBLIC_FIELDS).eq('id', userId).maybeSingle();
  if (error) throw error;
  if (!data) {
    const err = new Error('User tidak ditemukan');
    err.status = 404;
    throw err;
  }
  return {
    ...data,
    isVerified: data.verification_status === 'verified'
  };
}

export async function getPublicProfile(userIdOrUsername) {
  let query = supabase.from('users').select(PUBLIC_FIELDS);
  // UUID sederhana dideteksi dari format, kalau bukan berarti username
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userIdOrUsername);
  query = isUuid ? query.eq('id', userIdOrUsername) : query.eq('username', userIdOrUsername);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    ...data,
    isVerified: data.verification_status === 'verified'
  };
}

const EDITABLE_FIELDS = ['full_name', 'username', 'whatsapp', 'country', 'province', 'city', 'avatar_url', 'bio'];

export async function updateProfile(userId, updates) {
  const payload = {};
  for (const field of EDITABLE_FIELDS) {
    const camelKey = field.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    if (updates[field] !== undefined) payload[field] = updates[field];
    else if (updates[camelKey] !== undefined) payload[field] = updates[camelKey];
  }
  if (Object.keys(payload).length === 0) {
    const err = new Error('Tidak ada field yang diupdate');
    err.status = 400;
    throw err;
  }
  const { data, error } = await supabase.from('users').update(payload).eq('id', userId).select(PUBLIC_FIELDS).single();
  if (error) throw error;
  return {
    ...data,
    isVerified: data.verification_status === 'verified'
  };
}

// App.tsx: inisialisasi i18n dengan locale tersimpan saat user login. Route
// terpisah dari updateProfile (bukan lewat EDITABLE_FIELDS) karena dipanggil
// otomatis oleh app, bukan lewat form "edit profil" milik user.
export async function updateLanguage(userId, language) {
  if (!language) {
    const err = new Error('language wajib diisi');
    err.status = 400;
    throw err;
  }
  const { data, error } = await supabase.from('users').update({ locale: language }).eq('id', userId).select(PUBLIC_FIELDS).single();
  if (error) throw error;
  return data;
}

// Dipakai GroupView.tsx untuk menyarankan trader di kota/provinsi yang sama.
export async function searchUsersByLocation({ city, province }, limit = 50) {
  let query = supabase.from('users').select(PUBLIC_FIELDS);
  if (city) query = query.eq('city', city);
  else if (province) query = query.eq('province', province);
  const { data, error } = await query.limit(limit);
  if (error) throw error;
  return data || [];
}

export async function searchUsers(keyword, limit = 20) {
  const { data, error } = await supabase
    .from('users')
    .select(PUBLIC_FIELDS)
    .or(`full_name.ilike.%${keyword}%,username.ilike.%${keyword}%,email.ilike.%${keyword}%`)
    .limit(limit);
  if (error) throw error;
  return data || [];
}

// Leaderboard sederhana berbasis reputasi = total like yang diterima +
// jumlah post. Untuk versi lebih canggih (skor berbasis performa
// trading), gabungkan dengan data closed_trades_per_position dari
// TARAPTI DB (lihat mt5AdminService.js untuk pola query-nya).
export async function getLeaderboard(limit = 50) {
  const { data: users, error } = await supabase.from('users').select('id, full_name, username, avatar_url, country, city').limit(500);
  if (error) throw error;
  const userIds = (users || []).map((u) => u.id);
  if (userIds.length === 0) return [];

  const { data: likeRows } = await supabase.from('post_likes').select('post_id');
  const { data: posts } = await supabase.from('posts').select('id, user_id').in('user_id', userIds);
  const postOwnerByPostId = Object.fromEntries((posts || []).map((p) => [p.id, p.user_id]));

  const scoreByUser = {};
  for (const l of likeRows || []) {
    const owner = postOwnerByPostId[l.post_id];
    if (owner) scoreByUser[owner] = (scoreByUser[owner] || 0) + 1;
  }

  return users
    .map((u) => ({ ...u, reputationPoints: scoreByUser[u.id] || 0 }))
    .sort((a, b) => b.reputationPoints - a.reputationPoints)
    .slice(0, limit);
}
