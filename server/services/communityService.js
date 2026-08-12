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
