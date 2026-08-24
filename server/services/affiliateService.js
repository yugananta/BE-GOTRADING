// server/services/affiliateService.js
import { supabase } from '../integrations/supabase/client.js';

const PAGE_SIZE = 20;

export async function listAffiliateProfiles({ page = 1, search }) {
  let query = supabase
    .from('affiliate_profiles')
    .select('user_id, referral_code, is_active, total_earned, total_paid, created_at, updated_at, users:user_id(id, email, full_name, username, status, country)', { count: 'exact' });

  if (search) {
    // search in referral_code or user email / full_name
    query = query.or(`referral_code.ilike.%${search}%`);
  }

  const from = (page - 1) * PAGE_SIZE;
  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, from + PAGE_SIZE - 1);

  if (error) throw error;
  return { data: data || [], total: count || 0, page: Number(page) };
}

export async function getAffiliateProfileDetail(userId) {
  const { data: profile, error } = await supabase
    .from('affiliate_profiles')
    .select('*, users:user_id(id, email, full_name, username, status, country, province, city, created_at)')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  if (!profile) {
    const err = new Error('Affiliate profile tidak ditemukan');
    err.status = 404;
    throw err;
  }

  // Get Level 1 downline
  const { data: level1Refs } = await supabase
    .from('affiliate_referrals')
    .select('id, referred_user_id, created_at, users:referred_user_id(id, email, full_name, username, status, country)')
    .eq('sponsor_id', userId)
    .eq('level', 1);

  // Get Level 2 downline
  const { data: level2Refs } = await supabase
    .from('affiliate_referrals')
    .select('id, referred_user_id, sponsor_id, created_at, users:referred_user_id(id, email, full_name, username, status, country)')
    .eq('sponsor_id', userId)
    .eq('level', 2);

  return {
    ...profile,
    level1Referrals: level1Refs || [],
    level2Referrals: level2Refs || [],
    stats: {
      level1Count: (level1Refs || []).length,
      level2Count: (level2Refs || []).length,
      totalDownline: (level1Refs || []).length + (level2Refs || []).length,
    }
  };
}

export async function listAffiliateReferrals({ sponsorId, referredUserId, level, page = 1 }) {
  let query = supabase
    .from('affiliate_referrals')
    .select('id, sponsor_id, referred_user_id, level, created_at, sponsor:sponsor_id(id, email, full_name), referred:referred_user_id(id, email, full_name)', { count: 'exact' });

  if (sponsorId) query = query.eq('sponsor_id', sponsorId);
  if (referredUserId) query = query.eq('referred_user_id', referredUserId);
  if (level) query = query.eq('level', Number(level));

  const from = (page - 1) * PAGE_SIZE;
  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, from + PAGE_SIZE - 1);

  if (error) throw error;
  return { data: data || [], total: count || 0, page: Number(page) };
}

export async function getAffiliateSettings() {
  const { data, error } = await supabase
    .from('affiliate_settings')
    .select('*')
    .eq('id', true)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    return { id: true, level_1_rate: 0.10, level_2_rate: 0.05, updated_at: new Date().toISOString() };
  }
  return data;
}

export async function updateAffiliateSettings({ level1Rate, level2Rate }) {
  const patch = { updated_at: new Date().toISOString() };
  if (level1Rate !== undefined) patch.level_1_rate = Number(level1Rate);
  if (level2Rate !== undefined) patch.level_2_rate = Number(level2Rate);

  const { data, error } = await supabase
    .from('affiliate_settings')
    .update(patch)
    .eq('id', true)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function listAffiliateCommissions({ status, beneficiaryId, sourceUserId, level, page = 1 }) {
  let query = supabase
    .from('affiliate_commissions')
    .select('*, beneficiary:beneficiary_id(id, email, full_name), source:source_user_id(id, email, full_name)', { count: 'exact' });

  if (status) query = query.eq('status', status);
  if (beneficiaryId) query = query.eq('beneficiary_id', beneficiaryId);
  if (sourceUserId) query = query.eq('source_user_id', sourceUserId);
  if (level) query = query.eq('level', Number(level));

  const from = (page - 1) * PAGE_SIZE;
  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, from + PAGE_SIZE - 1);

  if (error) throw error;
  return { data: data || [], total: count || 0, page: Number(page) };
}

export async function updateCommissionStatus(id, status) {
  const validStatuses = ['pending', 'approved', 'paid', 'cancelled', 'reversed'];
  if (!validStatuses.includes(status)) {
    const err = new Error(`Status komisi tidak valid. Pilih: ${validStatuses.join(', ')}`);
    err.status = 400;
    throw err;
  }

  const patch = { status };
  if (status === 'paid') {
    patch.paid_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from('affiliate_commissions')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function listAffiliatePayouts({ status, userId, page = 1 }) {
  let query = supabase
    .from('affiliate_payouts')
    .select('*, user:user_id(id, email, full_name), processor:processed_by(id, email, full_name)', { count: 'exact' });

  if (status) query = query.eq('status', status);
  if (userId) query = query.eq('user_id', userId);

  const from = (page - 1) * PAGE_SIZE;
  const { data, error, count } = await query
    .order('requested_at', { ascending: false })
    .range(from, from + PAGE_SIZE - 1);

  if (error) throw error;
  return { data: data || [], total: count || 0, page: Number(page) };
}

export async function updatePayoutStatus(id, { status, notes, processedBy }) {
  const validStatuses = ['pending', 'processing', 'paid', 'rejected', 'cancelled'];
  if (status && !validStatuses.includes(status)) {
    const err = new Error(`Status payout tidak valid. Pilih: ${validStatuses.join(', ')}`);
    err.status = 400;
    throw err;
  }

  const patch = {};
  if (status) {
    patch.status = status;
    if (status === 'paid' || status === 'rejected' || status === 'cancelled') {
      patch.processed_at = new Date().toISOString();
      if (processedBy) patch.processed_by = processedBy;
    }
  }
  if (notes !== undefined) patch.notes = notes;

  const { data, error } = await supabase
    .from('affiliate_payouts')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}
