// server/services/postService.js
//
// Domain feed/posts. Desain dinormalisasi (junction table post_likes/
// post_bookmarks/post_reposts), BEDA dari versi lama frontend yang simpan
// likedBy/bookmarkedBy/repostedBy sebagai array JSON langsung di baris
// post -- itu rawan race condition kalau dua user like bersamaan (read-
// modify-write array). Bentuk respons tetap disamakan dengan interface
// `Post` di frontend (types.ts) supaya UI tidak perlu banyak berubah.

import { supabase } from '../integrations/supabase/client.js';
import { createNotification } from './notificationService.js';

const PAGE_SIZE = 20;

async function attachAuthorAndCounts(posts, viewerId) {
  if (posts.length === 0) return [];
  const postIds = posts.map((p) => p.id);
  const userIds = [...new Set(posts.map((p) => p.user_id))];

  const [{ data: authors }, { data: likes }, { data: bookmarks }, { data: reposts }, { data: commentCounts }] = await Promise.all([
    supabase.from('users').select('id, full_name, username, avatar_url, role, country, city').in('id', userIds),
    supabase.from('post_likes').select('post_id, user_id').in('post_id', postIds),
    supabase.from('post_bookmarks').select('post_id, user_id').in('post_id', postIds),
    supabase.from('post_reposts').select('post_id, user_id').in('post_id', postIds),
    supabase.from('comments').select('post_id').in('post_id', postIds),
  ]);

  const authorById = Object.fromEntries((authors || []).map((a) => [a.id, a]));
  const likesByPost = groupBy(likes || [], 'post_id');
  const bookmarksByPost = groupBy(bookmarks || [], 'post_id');
  const repostsByPost = groupBy(reposts || [], 'post_id');
  const commentCountByPost = {};
  (commentCounts || []).forEach((c) => { commentCountByPost[c.post_id] = (commentCountByPost[c.post_id] || 0) + 1; });

  return posts.map((p) => {
    const author = authorById[p.user_id] || {};
    const postLikes = likesByPost[p.id] || [];
    const postBookmarks = bookmarksByPost[p.id] || [];
    const postReposts = repostsByPost[p.id] || [];
    return {
      id: String(p.id),
      userId: p.user_id,
      authorName: author.full_name || author.username || author.email,
      authorUsername: author.username,
      authorAvatar: author.avatar_url,
      authorRole: author.role,
      authorCity: author.city,
      authorCountry: author.country,
      title: p.title,
      content: p.content,
      images: p.images || [],
      videoUrl: p.video_url,
      tags: p.tags || [],
      chart: p.chart,
      groupId: p.group_id ? String(p.group_id) : undefined,
      isRepost: !!p.original_post_id,
      isOfficial: p.is_official,
      isPinned: p.is_pinned,
      marketBias: p.market_bias,
      likesCount: postLikes.length,
      bookmarksCount: postBookmarks.length,
      repostsCount: postReposts.length,
      commentsCount: commentCountByPost[p.id] || 0,
      likedBy: postLikes.map((l) => l.user_id),
      bookmarkedBy: postBookmarks.map((b) => b.user_id),
      repostedBy: postReposts.map((r) => r.user_id),
      likedByMe: viewerId ? postLikes.some((l) => l.user_id === viewerId) : false,
      bookmarkedByMe: viewerId ? postBookmarks.some((b) => b.user_id === viewerId) : false,
      timestamp: p.created_at,
    };
  });
}

function groupBy(rows, key) {
  const out = {};
  for (const r of rows) {
    (out[r[key]] ||= []).push(r);
  }
  return out;
}

export async function listFeed({ page = 1, groupId, userId, search } = {}, viewerId) {
  const from = (page - 1) * PAGE_SIZE;
  let query = supabase
    .from('posts')
    .select('*')
    .order('is_pinned', { ascending: false })
    .order('is_official', { ascending: false })
    .order('created_at', { ascending: false })
    .range(from, from + PAGE_SIZE - 1);
  if (groupId) query = query.eq('group_id', groupId);
  if (userId) query = query.eq('user_id', userId);
  if (search) query = query.ilike('content', `%${search}%`);

  const { data, error } = await query;
  if (error) throw error;
  return attachAuthorAndCounts(data || [], viewerId);
}

export async function updatePost(postId, requesterId, { content, title, tags, images }) {
  const { data: post, error: fetchError } = await supabase.from('posts').select('user_id').eq('id', postId).maybeSingle();
  if (fetchError) throw fetchError;
  if (!post) {
    const err = new Error('Post tidak ditemukan');
    err.status = 404;
    throw err;
  }
  if (post.user_id !== requesterId) {
    const err = new Error('Tidak boleh mengedit post orang lain');
    err.status = 403;
    throw err;
  }
  const payload = { updated_at: new Date().toISOString() };
  if (content !== undefined) payload.content = content;
  if (title !== undefined) payload.title = title;
  if (tags !== undefined) payload.tags = tags;
  if (images !== undefined) payload.images = images;

  const { data, error } = await supabase.from('posts').update(payload).eq('id', postId).select().single();
  if (error) throw error;
  const [updated] = await attachAuthorAndCounts([data], requesterId);
  return updated;
}

export async function getPost(postId, viewerId) {
  const { data, error } = await supabase.from('posts').select('*').eq('id', postId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const [post] = await attachAuthorAndCounts([data], viewerId);
  return post;
}

export async function createPost(userId, { title, content, images, videoUrl, tags, chart, groupId, marketBias }) {
  if (!content) {
    const err = new Error('Konten post wajib diisi');
    err.status = 400;
    throw err;
  }
  const { data, error } = await supabase
    .from('posts')
    .insert({
      user_id: userId, title, content, images: images || [], video_url: videoUrl,
      tags: tags || [], chart, group_id: groupId || null, market_bias: marketBias,
    })
    .select()
    .single();
  if (error) throw error;
  const [post] = await attachAuthorAndCounts([data], userId);
  return post;
}

export async function deletePost(postId, requesterId) {
  const { data: post, error: fetchError } = await supabase.from('posts').select('user_id').eq('id', postId).maybeSingle();
  if (fetchError) throw fetchError;
  if (!post) {
    const err = new Error('Post tidak ditemukan');
    err.status = 404;
    throw err;
  }
  if (post.user_id !== requesterId) {
    const err = new Error('Tidak boleh menghapus post orang lain');
    err.status = 403;
    throw err;
  }
  const { error } = await supabase.from('posts').delete().eq('id', postId);
  if (error) throw error;
}

export async function toggleLike(postId, userId) {
  const { data: existing } = await supabase.from('post_likes').select('*').eq('post_id', postId).eq('user_id', userId).maybeSingle();
  if (existing) {
    await supabase.from('post_likes').delete().eq('post_id', postId).eq('user_id', userId);
    return { liked: false };
  }
  await supabase.from('post_likes').insert({ post_id: postId, user_id: userId });
  const { data: post } = await supabase.from('posts').select('user_id').eq('id', postId).maybeSingle();
  if (post) {
    await createNotification({ toUserId: post.user_id, fromUserId: userId, type: 'like', message: 'menyukai postingan Anda' });
  }
  return { liked: true };
}

export async function toggleBookmark(postId, userId) {
  const { data: existing } = await supabase.from('post_bookmarks').select('*').eq('post_id', postId).eq('user_id', userId).maybeSingle();
  if (existing) {
    await supabase.from('post_bookmarks').delete().eq('post_id', postId).eq('user_id', userId);
    return { bookmarked: false };
  }
  await supabase.from('post_bookmarks').insert({ post_id: postId, user_id: userId });
  return { bookmarked: true };
}

export async function repost(postId, userId) {
  const { data: existing } = await supabase.from('post_reposts').select('*').eq('post_id', postId).eq('user_id', userId).maybeSingle();
  if (existing) {
    const err = new Error('Sudah repost post ini');
    err.status = 409;
    throw err;
  }
  const { data: original, error: fetchError } = await supabase.from('posts').select('*').eq('id', postId).maybeSingle();
  if (fetchError) throw fetchError;
  if (!original) {
    const err = new Error('Post tidak ditemukan');
    err.status = 404;
    throw err;
  }
  await supabase.from('post_reposts').insert({ post_id: postId, user_id: userId });
  await createNotification({ toUserId: original.user_id, fromUserId: userId, type: 'repost', message: 'me-repost postingan Anda' });
  const { data: newPost, error } = await supabase
    .from('posts')
    .insert({ user_id: userId, content: original.content, original_post_id: postId })
    .select()
    .single();
  if (error) throw error;
  const [post] = await attachAuthorAndCounts([newPost], userId);
  return post;
}

// --- Comments ---

export async function listComments(postId) {
  const { data, error } = await supabase
    .from('comments')
    .select('id, post_id, user_id, title, content, created_at, users(full_name, username, avatar_url, country, city)')
    .eq('post_id', postId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map((c) => ({
    id: String(c.id),
    postId: String(c.post_id),
    userId: c.user_id,
    authorName: c.users?.full_name || c.users?.username,
    authorUsername: c.users?.username,
    authorAvatar: c.users?.avatar_url,
    authorCity: c.users?.city,
    authorCountry: c.users?.country,
    title: c.title,
    content: c.content,
    timestamp: c.created_at,
  }));
}

export async function createComment(postId, userId, { title, content }) {
  if (!content) {
    const err = new Error('Komentar tidak boleh kosong');
    err.status = 400;
    throw err;
  }
  const { data, error } = await supabase
    .from('comments')
    .insert({ post_id: postId, user_id: userId, title, content })
    .select()
    .single();
  if (error) throw error;
  const { data: post } = await supabase.from('posts').select('user_id').eq('id', postId).maybeSingle();
  if (post) {
    await createNotification({ toUserId: post.user_id, fromUserId: userId, type: 'comment', message: 'mengomentari postingan Anda' });
  }
  return data;
}

export async function deleteComment(commentId, requesterId) {
  const { data: comment, error: fetchError } = await supabase.from('comments').select('user_id').eq('id', commentId).maybeSingle();
  if (fetchError) throw fetchError;
  if (!comment) {
    const err = new Error('Komentar tidak ditemukan');
    err.status = 404;
    throw err;
  }
  if (comment.user_id !== requesterId) {
    const err = new Error('Tidak boleh menghapus komentar orang lain');
    err.status = 403;
    throw err;
  }
  const { error } = await supabase.from('comments').delete().eq('id', commentId);
  if (error) throw error;
}
