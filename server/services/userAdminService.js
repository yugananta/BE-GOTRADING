// server/services/userAdminService.js
import { supabase } from '../integrations/supabase/client.js';

const PAGE_SIZE = 20;

export async function listUsers({ page = 1, search, country, province, city, role, verificationStatus }) {
  let query = supabase
    .from('users')
    .select('id, email, full_name, username, country, province, city, whatsapp, role, status, verification_status, created_at', { count: 'exact' });

  if (search) query = query.ilike('email', `%${search}%`);
  if (country) query = query.eq('country', country);
  if (province) query = query.eq('province', province);
  if (city) query = query.eq('city', city);
  if (role) query = query.eq('role', role);
  if (verificationStatus) query = query.eq('verification_status', verificationStatus);

  const from = (page - 1) * PAGE_SIZE;
  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, from + PAGE_SIZE - 1);

  if (error) throw error;
  return { data, total: count, page: Number(page) };
}

export async function getUserDetail(id) {
  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  if (!user) {
    const err = new Error('User tidak ditemukan');
    err.status = 404;
    throw err;
  }
  delete user.password_hash;

  const { data: mt5Accounts } = await supabase
    .from('user_mt5_accounts')
    .select('*')
    .eq('user_id', id);

  const { data: referrals } = await supabase
    .from('users')
    .select('id, email, created_at')
    .eq('referred_by', id);

  return { ...user, mt5Accounts: mt5Accounts || [], referrals: referrals || [] };
}

export async function updateUser(id, { status, role, verificationStatus }) {
  const patch = {};
  if (status) patch.status = status;
  if (role) patch.role = role;
  if (verificationStatus) patch.verification_status = verificationStatus;

  if (Object.keys(patch).length === 0) {
    const err = new Error('Tidak ada field yang diubah');
    err.status = 400;
    throw err;
  }

  const { data, error } = await supabase
    .from('users')
    .update(patch)
    .eq('id', id)
    .select('id, email, status, role, verification_status')
    .single();

  if (error) throw error;
  return data;
}

export async function suspendUser(id) {
  const { data, error } = await supabase
    .from('users')
    .update({ status: 'suspended' })
    .eq('id', id)
    .select('id, email, status')
    .single();
  if (error) throw error;
  return data;
}
