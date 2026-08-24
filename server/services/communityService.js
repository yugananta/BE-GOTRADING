// server/services/communityService.js
//
// Community chat per kota/provinsi -- MVP pakai polling, bukan WebSocket/
// Supabase Realtime. Alasan: auth kita custom JWT, bukan Supabase Auth,
// jadi Row Level Security berbasis auth.uid() Supabase tidak otomatis
// berlaku -- lebih aman & konsisten tetap lewat backend ini.

import { supabase } from '../integrations/supabase/client.js';

const MESSAGE_PAGE_SIZE = 50;

export async function getOrCreateGroup({ country, province, city }) {
  const { data: existing } = await supabase
    .from('community_groups')
    .select('*')
    .eq('country', country)
    .eq('province', province)
    .is('city', city || null)
    .maybeSingle();

  if (existing) return existing;

  const name = city ? `${city}, ${province}` : `${province} (Semua Kota)`;
  const { data, error } = await supabase
    .from('community_groups')
    .insert({ country, province, city: city || null, name })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function listGroups({ country, province }) {
  let query = supabase.from('community_groups').select('*');
  if (country) query = query.eq('country', country);
  if (province) query = query.eq('province', province);

  const { data, error } = await query.order('name');
  if (error) throw error;
  return data;
}

// `since`: ISO timestamp opsional -- kalau diisi, cuma balikin pesan
// setelah timestamp itu (dipakai client buat polling pesan baru saja).
export async function getMessages(groupId, { since, page = 1 }) {
  let query = supabase
    .from('community_messages')
    .select('id, body, created_at, user_id, users(email)')
    .eq('group_id', groupId)
    .order('created_at', { ascending: true });

  if (since) {
    query = query.gt('created_at', since);
  } else {
    const offset = (page - 1) * MESSAGE_PAGE_SIZE;
    query = query.range(offset, offset + MESSAGE_PAGE_SIZE - 1);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function postMessage(groupId, userId, body) {
  if (!body || !body.trim()) {
    const err = new Error('Pesan tidak boleh kosong');
    err.status = 400;
    throw err;
  }
  if (body.length > 2000) {
    const err = new Error('Pesan terlalu panjang (maks 2000 karakter)');
    err.status = 400;
    throw err;
  }

  const { data, error } = await supabase
    .from('community_messages')
    .insert({ group_id: groupId, user_id: userId, body: body.trim() })
    .select('id, body, created_at, user_id')
    .single();

  if (error) throw error;
  return data;
}

// GroupView.tsx: statistik ringkas ("N anggota, N pesan") untuk grup kota
// dan grup provinsi sekaligus, dipakai buat badge di header grup.
export async function getGroupStats({ city, province }) {
  async function statFor(scope, value) {
    if (!value) return { members: 0, messages: 0 };

    const memberQuery = supabase.from('users').select('id', { count: 'exact', head: true });
    const { count: members } = scope === 'city'
      ? await memberQuery.eq('city', value)
      : await memberQuery.eq('province', value);

    // Grup dianggap ada kalau sudah pernah dibuat lewat community/posts --
    // kalau belum pernah, anggap 0 pesan (tidak perlu create grup kosong
    // hanya untuk baca statistik).
    let groupQuery = supabase.from('community_groups').select('id');
    groupQuery = scope === 'city' ? groupQuery.eq('city', value) : groupQuery.is('city', null).eq('province', value);
    const { data: groupRows } = await groupQuery;
    const groupIds = (groupRows || []).map((g) => g.id);

    let messages = 0;
    if (groupIds.length > 0) {
      const { count } = await supabase
        .from('posts')
        .select('id', { count: 'exact', head: true })
        .in('group_id', groupIds);
      messages = count || 0;
    }

    return { members: members || 0, messages };
  }

  const [cityStats, provinceStats] = await Promise.all([
    statFor('city', city),
    statFor('province', province),
  ]);

  return { city: cityStats, province: provinceStats };
}

const PUBLIC_MEMBER_FIELDS = 'id, full_name, username, email, whatsapp, country, province, city, avatar_url, bio, role, ib_region, verification_status, status, locale, created_at';

// GroupView.tsx: Ambil daftar anggota grup terpaginasi (batch fetch + index optimized)
// Mencegah N+1 query dengan melakukan batch join akun MT5 dan status follow sekaligus.
export async function getGroupMembers({
  groupId,
  country,
  province,
  city,
  search,
  page = 1,
  limit = 20,
  viewerId = null,
} = {}) {
  let targetCountry = country;
  let targetProvince = province;
  let targetCity = city;

  // Jika groupId dikirim, lookup lokasi grup terlebih dahulu
  if (groupId) {
    const { data: group } = await supabase
      .from('community_groups')
      .select('country, province, city')
      .eq('id', groupId)
      .maybeSingle();

    if (group) {
      targetCountry = group.country || targetCountry;
      targetProvince = group.province || targetProvince;
      targetCity = group.city || targetCity;
    }
  }

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * pageSize;

  // Helper untuk build filter query pengguna
  function applyFilters(query) {
    if (targetCity) {
      query = query.eq('city', targetCity);
    } else if (targetProvince) {
      query = query.eq('province', targetProvince);
    } else if (targetCountry) {
      query = query.eq('country', targetCountry);
    }

    if (search && search.trim()) {
      const s = search.trim();
      query = query.or(`full_name.ilike.%${s}%,username.ilike.%${s}%,email.ilike.%${s}%`);
    }
    return query;
  }

  // Jalankan query COUNT dan data secara paralel
  const countQuery = applyFilters(supabase.from('users').select('id', { count: 'exact', head: true }));
  const usersQuery = applyFilters(
    supabase
      .from('users')
      .select(PUBLIC_MEMBER_FIELDS)
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1)
  );

  const [{ count: totalCount, error: countErr }, { data: users, error: usersErr }] = await Promise.all([
    countQuery,
    usersQuery,
  ]);

  if (countErr) throw countErr;
  if (usersErr) throw usersErr;

  const userList = users || [];
  const total = totalCount || 0;

  if (userList.length === 0) {
    return {
      members: [],
      data: [],
      total,
      page: pageNum,
      limit: pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
      hasMore: false,
    };
  }

  const userIds = userList.map((u) => u.id);

  // Single-batch join: Ambil seluruh data MT5 dan relasi follow/koneksi sekaligus (Solusi N+1)
  const batchTasks = [
    supabase
      .from('user_mt5_accounts')
      .select('id, user_id, akun_id, status, conn_status, platform, server, broker, last_connected_at, total_pnl, performance_pct, drawdown_pct, peak_equity')
      .in('user_id', userIds),
  ];

  if (viewerId) {
    batchTasks.push(
      supabase
        .from('follows')
        .select('following_id')
        .eq('follower_id', viewerId)
        .in('following_id', userIds)
    );
  }

  const [mt5Res, followsRes] = await Promise.all(batchTasks);

  const mt5Map = {};
  for (const acc of mt5Res.data || []) {
    if (!mt5Map[acc.user_id]) mt5Map[acc.user_id] = [];
    mt5Map[acc.user_id].push(acc);
  }

  const followingSet = new Set((followsRes?.data || []).map((f) => f.following_id));

  const enrichedMembers = userList.map((u) => {
    const userMt5s = mt5Map[u.id] || [];
    const connectedAccounts = userMt5s.filter((a) => a.conn_status === 'connected');
    const totalPnl = userMt5s.reduce((sum, a) => sum + (Number(a.total_pnl) || 0), 0);
    const avgPerformance = userMt5s.length
      ? userMt5s.reduce((sum, a) => sum + (Number(a.performance_pct) || 0), 0) / userMt5s.length
      : 0;

    // Hitung status online & pengalaman trading tanpa N+1 queries
    const isOnline = u.status === 'active' && connectedAccounts.length > 0;
    const tradingExp = userMt5s.length > 0
      ? {
          hasConnectedAccount: connectedAccounts.length > 0,
          totalAccounts: userMt5s.length,
          totalPnl,
          performancePct: Math.round(avgPerformance * 100) / 100,
          broker: userMt5s[0]?.broker || userMt5s[0]?.server || 'MetaTrader 5',
          accountsCount: userMt5s.length,
        }
      : null;

    return {
      ...u,
      isVerified: u.verification_status === 'verified',
      isOnline,
      onlineStatus: isOnline ? 'online' : (u.status || 'offline'),
      tradingExperience: tradingExp,
      hasMt5: userMt5s.length > 0,
      mt5Accounts: userMt5s,
      isFollowing: viewerId ? followingSet.has(u.id) : false,
    };
  });

  return {
    members: enrichedMembers,
    data: enrichedMembers,
    total,
    page: pageNum,
    limit: pageSize,
    totalPages: Math.ceil(total / pageSize) || 1,
    hasMore: offset + enrichedMembers.length < total,
  };
}

