// server/services/storyService.js
import { supabase } from '../integrations/supabase/client.js';

export async function listActiveStories() {
  const { data, error } = await supabase
    .from('stories')
    .select('id, user_id, image_url, created_at, expires_at, users(full_name, username, avatar_url)')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map((s) => ({
    id: String(s.id),
    userId: s.user_id,
    authorName: s.users?.full_name || s.users?.username,
    authorAvatar: s.users?.avatar_url,
    imageUrl: s.image_url,
    timestamp: s.created_at,
    expiresAt: s.expires_at,
  }));
}

export async function createStory(userId, { imageUrl }) {
  if (!imageUrl) {
    const err = new Error('imageUrl wajib diisi');
    err.status = 400;
    throw err;
  }

  // Story baru menggantikan story lama milik user yang sama (bukan
  // menumpuk) -- samakan dengan perilaku di server.ts AI Studio.
  await supabase.from('stories').delete().eq('user_id', userId);

  const { data, error } = await supabase
    .from('stories')
    .insert({ user_id: userId, image_url: imageUrl })
    .select()
    .single();
  if (error) throw error;
  return { id: String(data.id), userId: data.user_id, imageUrl: data.image_url, timestamp: data.created_at, expiresAt: data.expires_at };
}

// Dipanggil saat user membuka story orang lain (StoriesList.tsx). Insert
// idempotent -- kalau viewer yang sama buka berkali-kali, tidak dobel baris
// (lihat primary key gabungan story_id+viewer_id di sql/11).
export async function recordView(storyId, viewerId) {
  const { error: upsertError } = await supabase
    .from('story_views')
    .upsert({ story_id: storyId, viewer_id: viewerId }, { onConflict: 'story_id,viewer_id', ignoreDuplicates: true });
  if (upsertError) throw upsertError;

  const { data, error } = await supabase
    .from('story_views')
    .select('viewer_id, viewed_at, users(id, full_name, username, avatar_url)')
    .eq('story_id', storyId)
    .order('viewed_at', { ascending: false });
  if (error) throw error;

  return (data || []).map((v) => ({
    userId: v.viewer_id,
    viewedAt: v.viewed_at,
    user: v.users ? {
      id: v.users.id,
      firstName: v.users.full_name,
      username: v.users.username,
      avatar: v.users.avatar_url,
    } : undefined,
  }));
}

// Hanya pemilik story yang boleh menghapus miliknya sendiri.
export async function deleteStory(storyId, userId) {
  const { data, error } = await supabase
    .from('stories')
    .delete()
    .eq('id', storyId)
    .eq('user_id', userId)
    .select()
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    const err = new Error('Story tidak ditemukan atau bukan milik Anda');
    err.status = 404;
    throw err;
  }
  return { success: true };
}
