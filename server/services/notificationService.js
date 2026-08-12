// server/services/notificationService.js
import { supabase } from '../integrations/supabase/client.js';

// Dipanggil dari service lain (like, comment, follow, dst) untuk membuat
// notifikasi -- bukan lewat HTTP endpoint, supaya konsisten & tidak bisa
// dipalsukan dari client.
export async function createNotification({ toUserId, fromUserId, type, message, assetClass }) {
  if (toUserId === fromUserId) return null; // tidak perlu notifikasi ke diri sendiri
  const { data, error } = await supabase
    .from('notifications')
    .insert({ to_user_id: toUserId, from_user_id: fromUserId, type, message, asset_class: assetClass })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function listMyNotifications(userId) {
  const { data, error } = await supabase
    .from('notifications')
    .select('*, users!notifications_from_user_id_fkey(full_name, username, avatar_url)')
    .eq('to_user_id', userId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data || []).map((n) => ({
    id: String(n.id),
    toUserId: n.to_user_id,
    fromUserId: n.from_user_id,
    fromUserName: n.users?.full_name || n.users?.username,
    fromUserAvatar: n.users?.avatar_url,
    type: n.type,
    message: n.message,
    isRead: n.is_read,
    assetClass: n.asset_class,
    timestamp: n.created_at,
  }));
}

export async function markAllAsRead(userId) {
  const { error } = await supabase.from('notifications').update({ is_read: true }).eq('to_user_id', userId).eq('is_read', false);
  if (error) throw error;
}

export async function markOneAsRead(id, userId) {
  const { error } = await supabase.from('notifications').update({ is_read: true }).eq('id', id).eq('to_user_id', userId);
  if (error) throw error;
}

export async function deleteNotification(id, userId) {
  const { error } = await supabase.from('notifications').delete().eq('id', id).eq('to_user_id', userId);
  if (error) throw error;
}

export async function deleteNotificationsByType(userId, type) {
  const { error } = await supabase.from('notifications').delete().eq('to_user_id', userId).eq('type', type);
  if (error) throw error;
}
