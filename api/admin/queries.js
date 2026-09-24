import { getAdminContext, json, method, hasPermission, writeAudit } from '../../lib/admin-server.js';

const STATUSES = ['new', 'read', 'replied', 'closed', 'spam'];

export default async function handler(req, res) {
  if (!method(req, res, ['GET', 'POST'])) return;
  const ctx = await getAdminContext(req);
  if (!ctx) return json(res, 401, { error: 'Admin authorization required.' });
  if (!hasPermission(ctx, 'VIEW_QUERIES')) return json(res, 403, { error: 'Query access permission required.' });

  if (req.method === 'GET') {
    const status = String(req.query?.status || '').trim();
    if (status && !STATUSES.includes(status)) return json(res, 400, { error: 'Invalid query status.' });

    let query = ctx.client
      .from('queries')
      .select('*,query_replies(id,admin_id,message,email_status,scheduled_at,sent_at,created_at)')
      .order('created_at', { ascending: false })
      .limit(100);

    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) return json(res, 500, { error: error.message });
    return json(res, 200, { queries: data || [] });
  }

  const id = String(req.body?.id || '');
  const status = String(req.body?.status || '');
  if (!id || !STATUSES.includes(status)) return json(res, 400, { error: 'Valid query ID and status are required.' });

  const { error } = await ctx.client.from('queries').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) return json(res, 400, { error: error.message });
  await writeAudit(ctx.client, ctx.user.id, 'QUERY_STATUS_CHANGED', 'query', id, { status });
  return json(res, 200, { ok: true });
}
