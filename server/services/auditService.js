// server/services/auditService.js
import { supabase } from '../integrations/supabase/client.js';

const PAGE_SIZE = 30;

export async function logAdminAction({ adminId, action, targetType, targetId, detail }) {
  const { error } = await supabase
    .from('admin_audit_log')
    .insert({ admin_id: adminId, action, target_type: targetType, target_id: String(targetId), detail: detail || null });
  if (error) console.error('Gagal mencatat audit log:', error);
}

export async function listAuditLog({ page = 1, adminId }) {
  let query = supabase.from('admin_audit_log').select('*, users(email)', { count: 'exact' });
  if (adminId) query = query.eq('admin_id', adminId);

  const from = (page - 1) * PAGE_SIZE;
  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, from + PAGE_SIZE - 1);

  if (error) throw error;
  return { data, total: count, page: Number(page) };
}
