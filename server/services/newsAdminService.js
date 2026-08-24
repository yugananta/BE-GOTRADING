// server/services/newsAdminService.js
//
// CRUD berita/pengumuman MANUAL yang dibuat admin (tabel news_posts).
// Beda dari news_cache (services/newsService.js) yang isinya hasil
// fetch API luar untuk end-user.

import { supabase } from '../integrations/supabase/client.js';

export async function listNewsPosts() {
  const { data, error } = await supabase
    .from('news_posts')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function createNewsPost({ title, body, authorId, published = false }) {
  if (!title || !body) {
    const err = new Error('title dan body wajib diisi');
    err.status = 400;
    throw err;
  }
  const { data, error } = await supabase
    .from('news_posts')
    .insert({ title, body, author_id: authorId, published })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateNewsPost(id, { title, body, published }) {
  const patch = { updated_at: new Date().toISOString() };
  if (title !== undefined) patch.title = title;
  if (body !== undefined) patch.body = body;
  if (published !== undefined) patch.published = published;

  const { data, error } = await supabase
    .from('news_posts')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteNewsPost(id) {
  const { error } = await supabase.from('news_posts').delete().eq('id', id);
  if (error) throw error;
}
