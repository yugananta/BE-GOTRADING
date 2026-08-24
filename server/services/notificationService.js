// server/services/notificationService.js
import { supabase } from '../integrations/supabase/client.js';

function formatNotification(n) {
  const isRead = Boolean(n.is_read);
  return {
    id: String(n.id),
    toUserId: n.to_user_id,
    to_user_id: n.to_user_id,
    fromUserId: n.from_user_id,
    from_user_id: n.from_user_id,
    fromUserName: n.users?.full_name || n.users?.username || null,
    fromUserAvatar: n.users?.avatar_url || null,
    fromUser: n.users ? {
      id: n.from_user_id,
      fullName: n.users.full_name,
      username: n.users.username,
      avatarUrl: n.users.avatar_url,
    } : null,
    type: n.type,
    message: n.message,
    isRead,
    is_read: isRead,
    assetClass: n.asset_class,
    asset_class: n.asset_class,
    timestamp: n.created_at,
    createdAt: n.created_at,
    created_at: n.created_at,
  };
}

// Dipanggil dari service lain (like, comment, follow, dst) atau API route untuk membuat
// notifikasi langsung tersimpan ke database (PostgreSQL) sebagai single source of truth.
export async function createNotification({ toUserId, fromUserId, type, message, assetClass }) {
  if (toUserId && fromUserId && toUserId === fromUserId) return null; // tidak perlu notifikasi ke diri sendiri
  
  const insertPayload = {
    to_user_id: toUserId,
    from_user_id: fromUserId || null,
    type,
    message,
    asset_class: assetClass || null,
    is_read: false,
  };

  const { data, error } = await supabase
    .from('notifications')
    .insert(insertPayload)
    .select('*, users!notifications_from_user_id_fkey(full_name, username, avatar_url)')
    .maybeSingle();

  if (error) {
    // Fallback jika foreign key join users null
    const fallback = await supabase
      .from('notifications')
      .insert(insertPayload)
      .select()
      .single();
    if (fallback.error) throw fallback.error;
    return formatNotification(fallback.data);
  }

  return formatNotification(data);
}

const userNotificationsCache = new Map();

export async function listMyNotifications(userId) {
  const { data, error } = await supabase
    .from('notifications')
    .select('*, users!notifications_from_user_id_fkey(full_name, username, avatar_url)')
    .eq('to_user_id', userId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    console.error(`[Supabase Error] Gagal memuat notifikasi untuk user ${userId}:`, error.message || error);
    // Silent Fallback ke in-memory cache jika query DB gagal
    const cachedData = userNotificationsCache.get(userId) || [];
    return {
      data: cachedData,
      meta: { stale: true, source: 'cache', error: error.message }
    };
  }

  const formattedData = (data || []).map(formatNotification);
  // Update in-memory cache
  userNotificationsCache.set(userId, formattedData);

  return {
    data: formattedData,
    meta: { stale: false, source: 'database' }
  };
}

export async function getUnreadCount(userId) {
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('to_user_id', userId)
    .eq('is_read', false);
  if (error) throw error;
  return count || 0;
}

export async function markAllAsRead(userId) {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('to_user_id', userId)
    .eq('is_read', false);
  if (error) throw error;
  return { success: true };
}

export async function markOneAsRead(id, userId) {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('id', id)
    .eq('to_user_id', userId);
  if (error) throw error;
  return { success: true, id: String(id), isRead: true };
}

export async function deleteNotification(id, userId) {
  const { error } = await supabase
    .from('notifications')
    .delete()
    .eq('id', id)
    .eq('to_user_id', userId);
  if (error) throw error;
  return { success: true, id: String(id) };
}

export async function deleteNotificationsByType(userId, type) {
  const { error } = await supabase
    .from('notifications')
    .delete()
    .eq('to_user_id', userId)
    .eq('type', type);
  if (error) throw error;
  return { success: true, type };
}

