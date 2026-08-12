// server/services/messageService.js
//
// Chat 1-on-1 -- MVP polling sama seperti community chat (lihat
// communityService.js), bukan WebSocket, dengan alasan yang sama (auth
// custom JWT, bukan Supabase Auth, jadi Realtime RLS tidak otomatis jalan).

import { supabase } from '../integrations/supabase/client.js';
import { createNotification } from './notificationService.js';

const PAGE_SIZE = 50;

export async function listChatSessions(userId) {
  const { data, error } = await supabase
    .from('messages')
    .select('id, sender_id, receiver_id, content, created_at, is_read')
    .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
    .order('created_at', { ascending: false });
  if (error) throw error;

  // Kelompokkan jadi satu sesi per lawan bicara, ambil pesan terakhir + unread count
  const sessions = {};
  for (const m of data || []) {
    const partnerId = m.sender_id === userId ? m.receiver_id : m.sender_id;
    if (!sessions[partnerId]) {
      sessions[partnerId] = { userId: partnerId, lastMessage: m.content, lastMessageTime: m.created_at, unreadCount: 0 };
    }
    if (m.receiver_id === userId && !m.is_read) sessions[partnerId].unreadCount += 1;
  }

  const partnerIds = Object.keys(sessions);
  if (partnerIds.length === 0) return [];
  const { data: partners } = await supabase
    .from('users').select('id, full_name, username, avatar_url, country, city').in('id', partnerIds);
  const partnerById = Object.fromEntries((partners || []).map((p) => [p.id, p]));

  return partnerIds.map((id) => ({
    ...sessions[id],
    username: partnerById[id]?.username,
    firstName: partnerById[id]?.full_name?.split(' ')[0] || partnerById[id]?.username,
    avatar: partnerById[id]?.avatar_url,
    city: partnerById[id]?.city,
    country: partnerById[id]?.country,
  }));
}

export async function listHistory(userId, partnerId, { since } = {}) {
  let query = supabase
    .from('messages')
    .select('*, message_reactions(user_id, emoji)')
    .or(`and(sender_id.eq.${userId},receiver_id.eq.${partnerId}),and(sender_id.eq.${partnerId},receiver_id.eq.${userId})`)
    .order('created_at', { ascending: true })
    .limit(PAGE_SIZE);
  if (since) query = query.gt('created_at', since);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map((m) => ({
    id: String(m.id),
    senderId: m.sender_id,
    receiverId: m.receiver_id,
    title: m.title,
    content: m.content,
    image: m.image,
    fileUrl: m.file_url,
    fileName: m.file_name,
    reactions: (m.message_reactions || []).map((r) => ({ userId: r.user_id, emoji: r.emoji })),
    timestamp: m.created_at,
    isRead: m.is_read,
    isDelivered: m.is_delivered,
  }));
}

export async function sendMessage(senderId, receiverId, { content, title, image, fileUrl, fileName }) {
  if (!content && !image && !fileUrl) {
    const err = new Error('Pesan tidak boleh kosong');
    err.status = 400;
    throw err;
  }
  const { data, error } = await supabase
    .from('messages')
    .insert({ sender_id: senderId, receiver_id: receiverId, content, title, image, file_url: fileUrl, file_name: fileName, is_delivered: true })
    .select()
    .single();
  if (error) throw error;
  await createNotification({ toUserId: receiverId, fromUserId: senderId, type: 'message', message: content ? content.slice(0, 80) : 'mengirim pesan' });
  return data;
}

export async function markAsRead(receiverId, senderId) {
  const { error } = await supabase
    .from('messages')
    .update({ is_read: true })
    .eq('receiver_id', receiverId)
    .eq('sender_id', senderId)
    .eq('is_read', false);
  if (error) throw error;
}

export async function toggleReaction(messageId, userId, emoji) {
  const { data: existing } = await supabase
    .from('message_reactions').select('*').eq('message_id', messageId).eq('user_id', userId).eq('emoji', emoji).maybeSingle();
  if (existing) {
    await supabase.from('message_reactions').delete().eq('message_id', messageId).eq('user_id', userId).eq('emoji', emoji);
    return { reacted: false };
  }
  await supabase.from('message_reactions').insert({ message_id: messageId, user_id: userId, emoji });
  return { reacted: true };
}
