// server/services/connectionService.js
import { supabase } from '../integrations/supabase/client.js';
import { createNotification } from './notificationService.js';

export async function requestConnection(requesterId, receiverId) {
  if (requesterId === receiverId) {
    const err = new Error('Tidak bisa connect ke diri sendiri');
    err.status = 400;
    throw err;
  }
  const { data, error } = await supabase
    .from('connections')
    .insert({ requester_id: requesterId, receiver_id: receiverId, status: 'pending' })
    .select()
    .single();
  if (error) throw error;
  await createNotification({ toUserId: receiverId, fromUserId: requesterId, type: 'friend_request', message: 'mengirim permintaan koneksi' });
  return data;
}

export async function respondConnection(requesterId, receiverId, status) {
  if (!['accepted', 'declined'].includes(status)) {
    const err = new Error('Status tidak valid');
    err.status = 400;
    throw err;
  }
  const { data, error } = await supabase
    .from('connections')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('requester_id', requesterId)
    .eq('receiver_id', receiverId)
    .select()
    .single();
  if (error) throw error;
  if (status === 'accepted') {
    await createNotification({ toUserId: requesterId, fromUserId: receiverId, type: 'friend_accepted', message: 'menerima permintaan koneksi Anda' });
  }
  return data;
}

export async function removeConnection(userIdA, userIdB) {
  const { error } = await supabase
    .from('connections')
    .delete()
    .or(`and(requester_id.eq.${userIdA},receiver_id.eq.${userIdB}),and(requester_id.eq.${userIdB},receiver_id.eq.${userIdA})`);
  if (error) throw error;
}

// Dipakai Network.tsx untuk menampilkan tombol yang tepat (Connect /
// Pending / Connected) tanpa harus load seluruh daftar koneksi.
export async function getConnectionStatus(userIdA, userIdB) {
  const { data, error } = await supabase
    .from('connections')
    .select('requester_id, receiver_id, status')
    .or(`and(requester_id.eq.${userIdA},receiver_id.eq.${userIdB}),and(requester_id.eq.${userIdB},receiver_id.eq.${userIdA})`)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { status: 'none' };
  return { status: data.status, requesterId: data.requester_id, receiverId: data.receiver_id };
}

// Dipanggil AppContext.tsx untuk badge notifikasi "permintaan koneksi
// masuk" -- beda dari listMyConnections (yang isinya SEMUA koneksi tanpa
// memandang status/arah).
export async function listPendingConnections(userId) {
  const { data, error } = await supabase
    .from('connections')
    .select('requester_id, receiver_id, status, created_at, requester:requester_id(id, full_name, username, avatar_url, city, country)')
    .eq('receiver_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map((c) => ({
    id: c.requester_id,
    requesterId: c.requester_id,
    receiverId: c.receiver_id,
    firstName: c.requester?.full_name,
    username: c.requester?.username,
    avatar: c.requester?.avatar_url,
    city: c.requester?.city,
    country: c.requester?.country,
    timestamp: c.created_at,
  }));
}

export async function listMyConnections(userId) {
  const { data, error } = await supabase
    .from('connections')
    .select('*')
    .or(`requester_id.eq.${userId},receiver_id.eq.${userId}`);
  if (error) throw error;
  return data || [];
}
