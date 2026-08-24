// server/services/followService.js
import { supabase } from '../integrations/supabase/client.js';
import { createNotification } from './notificationService.js';

export async function follow(followerId, followingId) {
  if (followerId === followingId) {
    const err = new Error('Tidak bisa follow diri sendiri');
    err.status = 400;
    throw err;
  }
  const { error } = await supabase.from('follows').upsert({ follower_id: followerId, following_id: followingId });
  if (error) throw error;
  await createNotification({ toUserId: followingId, fromUserId: followerId, type: 'follow', message: 'mulai mengikuti Anda' });
}

export async function unfollow(followerId, followingId) {
  const { error } = await supabase.from('follows').delete().eq('follower_id', followerId).eq('following_id', followingId);
  if (error) throw error;
}

export async function listFollowers(userId) {
  const { data, error } = await supabase.from('follows').select('follower_id').eq('following_id', userId);
  if (error) throw error;
  return (data || []).map((r) => r.follower_id);
}

export async function listFollowing(userId) {
  const { data, error } = await supabase.from('follows').select('following_id').eq('follower_id', userId);
  if (error) throw error;
  return (data || []).map((r) => r.following_id);
}

export async function isFollowing(followerId, followingId) {
  const { data } = await supabase.from('follows').select('follower_id').eq('follower_id', followerId).eq('following_id', followingId).maybeSingle();
  return !!data;
}
