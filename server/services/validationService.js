// server/services/validationService.js
import { supabase } from '../integrations/supabase/client.js';
import {
  sendAdminNewValidationNotification,
  sendUserValidationApprovedNotification,
  sendUserValidationRejectedNotification,
} from './emailService.js';
import { createNotification } from './notificationService.js';

function formatValidation(v) {
  if (!v) return null;
  return {
    id: String(v.id),
    userId: v.user_id,
    user_id: v.user_id,
    fullName: v.full_name,
    full_name: v.full_name,
    email: v.email,
    mt5AccountNumber: v.mt5_account_number,
    mt5_account_number: v.mt5_account_number,
    status: v.status,
    reviewedBy: v.reviewed_by,
    reviewed_by: v.reviewed_by,
    reviewedAt: v.reviewed_at,
    reviewed_at: v.reviewed_at,
    rejectionReason: v.rejection_reason,
    rejection_reason: v.rejection_reason,
    createdAt: v.created_at,
    created_at: v.created_at,
    updatedAt: v.updated_at,
    updated_at: v.updated_at,
    user: v.users ? {
      id: v.users.id,
      fullName: v.users.full_name,
      username: v.users.username,
      email: v.users.email,
      avatarUrl: v.users.avatar_url,
    } : undefined,
    reviewer: v.reviewer ? {
      id: v.reviewer.id,
      fullName: v.reviewer.full_name,
      email: v.reviewer.email,
    } : undefined,
  };
}

/**
 * User submit validation for MT5 account
 */
export async function submitValidation(userId, { fullName, full_name, email, mt5AccountNumber, mt5_account_number }) {
  const cleanFullName = (fullName || full_name || '').trim();
  const cleanEmail = (email || '').trim().toLowerCase();
  const rawMt5 = String(mt5AccountNumber || mt5_account_number || '').trim().replace(/\s/g, '');

  if (!cleanFullName) {
    const err = new Error('Nama lengkap wajib diisi');
    err.status = 400;
    throw err;
  }

  if (!cleanEmail || !cleanEmail.includes('@')) {
    const err = new Error('Email valid wajib diisi');
    err.status = 400;
    throw err;
  }

  if (!rawMt5 || !/^\d+$/.test(rawMt5)) {
    const err = new Error('Nomor akun MT5 harus berupa angka');
    err.status = 400;
    throw err;
  }

  // Insert validation submission
  const insertPayload = {
    user_id: userId,
    full_name: cleanFullName,
    email: cleanEmail,
    mt5_account_number: rawMt5,
    status: 'pending',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('account_validations')
    .insert(insertPayload)
    .select()
    .single();

  if (error) {
    console.error('[VALIDATION] Failed to insert account_validations:', error.message);
    throw error;
  }

  const formatted = formatValidation(data);

  // Ambil email semua admin untuk notifikasi email & in-app
  (async () => {
    try {
      const { data: admins } = await supabase
        .from('users')
        .select('id, email')
        .eq('role', 'admin');

      const adminEmails = (admins || []).map((a) => a.email).filter(Boolean);
      await sendAdminNewValidationNotification({ validation: formatted, adminEmails });

      // In-app notification ke semua admin
      for (const admin of admins || []) {
        await createNotification({
          toUserId: admin.id,
          fromUserId: userId,
          type: 'validation_submitted',
          message: `Pengajuan validasi akun MT5 baru (${rawMt5}) oleh ${cleanFullName}.`,
          assetClass: 'validation',
        }).catch((e) => console.warn('[NOTIF] Admin in-app notify failed:', e.message));
      }
    } catch (notifErr) {
      console.warn('[VALIDATION] Background admin notification error:', notifErr.message);
    }
  })();

  return formatted;
}

/**
 * User get their latest validation status
 */
export async function getLatestValidationStatus(userId) {
  if (!userId) {
    return { status: 'none', validation: null };
  }

  const { data, error } = await supabase
    .from('account_validations')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[VALIDATION] Error fetching latest validation status:', error.message);
    throw error;
  }

  if (!data) {
    return {
      status: 'none',
      validation: null,
    };
  }

  return {
    status: data.status,
    validation: formatValidation(data),
  };
}

/**
 * Admin list all validations with filtering & pagination
 */
export async function listAdminValidations({ status, search, page = 1, limit = 20 }) {
  const pageNum = Math.max(1, Number(page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(limit) || 20));
  const from = (pageNum - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('account_validations')
    .select('*, users!account_validations_user_id_fkey(id, full_name, username, email, avatar_url), reviewer:users!account_validations_reviewed_by_fkey(id, full_name, email)', { count: 'exact' });

  if (status && ['pending', 'approved', 'rejected'].includes(status.toLowerCase())) {
    query = query.eq('status', status.toLowerCase());
  }

  if (search && search.trim()) {
    const s = search.trim();
    query = query.or(`full_name.ilike.%${s}%,email.ilike.%${s}%,mt5_account_number.ilike.%${s}%`);
  }

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) {
    // Fallback jika foreign key alias users/reviewer perlu query sederhana
    console.warn('[VALIDATION] Join query fallback:', error.message);
    let fallbackQuery = supabase
      .from('account_validations')
      .select('*', { count: 'exact' });

    if (status && ['pending', 'approved', 'rejected'].includes(status.toLowerCase())) {
      fallbackQuery = fallbackQuery.eq('status', status.toLowerCase());
    }

    if (search && search.trim()) {
      const s = search.trim();
      fallbackQuery = fallbackQuery.or(`full_name.ilike.%${s}%,email.ilike.%${s}%,mt5_account_number.ilike.%${s}%`);
    }

    const fallbackResult = await fallbackQuery
      .order('created_at', { ascending: false })
      .range(from, to);

    if (fallbackResult.error) throw fallbackResult.error;

    const formattedList = (fallbackResult.data || []).map(formatValidation);
    const totalCount = fallbackResult.count || 0;
    return {
      data: formattedList,
      pagination: {
        total: totalCount,
        page: pageNum,
        limit: pageSize,
        totalPages: Math.ceil(totalCount / pageSize) || 1,
      },
    };
  }

  const formattedList = (data || []).map(formatValidation);
  const totalCount = count || 0;

  return {
    data: formattedList,
    pagination: {
      total: totalCount,
      page: pageNum,
      limit: pageSize,
      totalPages: Math.ceil(totalCount / pageSize) || 1,
    },
  };
}

/**
 * Admin approves validation
 */
export async function approveValidation(validationId, adminId) {
  if (!validationId) {
    const err = new Error('ID validasi wajib disertakan');
    err.status = 400;
    throw err;
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('account_validations')
    .update({
      status: 'approved',
      reviewed_by: adminId,
      reviewed_at: now,
      updated_at: now,
    })
    .eq('id', validationId)
    .select()
    .single();

  if (error) {
    console.error('[VALIDATION] Failed to approve validation:', error.message);
    throw error;
  }

  const formatted = formatValidation(data);

  // Kirim email & notifikasi ke user
  (async () => {
    try {
      await sendUserValidationApprovedNotification({ validation: formatted });
      await createNotification({
        toUserId: formatted.userId,
        fromUserId: adminId,
        type: 'validation_approved',
        message: `Validasi akun MT5 ${formatted.mt5AccountNumber} berhasil disetujui! Anda sekarang dapat menghubungkan akun di dashboard.`,
        assetClass: 'validation',
      });
    } catch (err) {
      console.warn('[VALIDATION] Notification after approve error:', err.message);
    }
  })();

  return formatted;
}

/**
 * Admin rejects validation
 */
export async function rejectValidation(validationId, adminId, reason) {
  if (!validationId) {
    const err = new Error('ID validasi wajib disertakan');
    err.status = 400;
    throw err;
  }

  const cleanReason = (reason || '').trim() || 'Nomor akun MT5 tidak terdaftar di bawah IB GoTrading.';
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('account_validations')
    .update({
      status: 'rejected',
      rejection_reason: cleanReason,
      reviewed_by: adminId,
      reviewed_at: now,
      updated_at: now,
    })
    .eq('id', validationId)
    .select()
    .single();

  if (error) {
    console.error('[VALIDATION] Failed to reject validation:', error.message);
    throw error;
  }

  const formatted = formatValidation(data);

  // Kirim email & notifikasi ke user
  (async () => {
    try {
      await sendUserValidationRejectedNotification({ validation: formatted, reason: cleanReason });
      await createNotification({
        toUserId: formatted.userId,
        fromUserId: adminId,
        type: 'validation_rejected',
        message: `Validasi akun MT5 ${formatted.mt5AccountNumber} ditolak: ${cleanReason}`,
        assetClass: 'validation',
      });
    } catch (err) {
      console.warn('[VALIDATION] Notification after reject error:', err.message);
    }
  })();

  return formatted;
}
