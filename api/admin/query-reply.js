import { getAdminContext, json, method, hasPermission } from '../../lib/admin-server.js';

// Compatibility endpoint: email delivery now happens in Supabase Edge Functions.
// The frontend calls the Edge Function directly, but this keeps older clients working.
export default async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;
  const ctx = await getAdminContext(req);
  if (!ctx) return json(res, 401, { error: 'Admin authorization required.' });
  if (!hasPermission(ctx, 'REPLY_QUERIES')) return json(res, 403, { error: 'Reply permission required.' });

  const baseUrl = process.env.SUPABASE_URL;
  const serverKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serverKey) return json(res, 503, { error: 'Supabase server configuration is missing.' });

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/functions/v1/reply-query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: req.headers.authorization || '',
        apikey: serverKey,
      },
      body: JSON.stringify({
        id: req.body?.id,
        message: req.body?.message,
      }),
    });

    const data = await response.json().catch(() => ({}));
    return json(res, response.status, data);
  } catch (error) {
    return json(res, 502, { error: error?.message || 'Unable to reach Supabase email function.' });
  }
}
