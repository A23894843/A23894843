import { createClient } from '@supabase/supabase-js';

export function getServerClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase server configuration is missing.');
  return createClient(url, key, { auth: { persistSession:false, autoRefreshToken:false, detectSessionInUrl:false } });
}

export async function getUserFromRequest(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;
  const client = getServerClient();
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

export async function getAdminContext(req) {
  const user = await getUserFromRequest(req);
  if (!user) return null;
  const client = getServerClient();
  const { data, error } = await client
    .from('profiles')
    .select('id,display_name,phone,role,status,created_at,updated_at')
    .eq('id', user.id).single();
  if (error || !data || data.status !== 'approved' || !['owner','admin','support'].includes(data.role)) return null;
  const { data: permissions } = await client.from('admin_permissions').select('permission').eq('user_id', user.id);
  return { user, profile:data, permissions:(permissions||[]).map(x=>x.permission), isOwner:data.role==='owner', client };
}

export function hasPermission(ctx, permission) {
  return Boolean(ctx && (ctx.isOwner || ctx.permissions.includes(permission)));
}

export function json(res, status, body) {
  res.status(status).json(body);
}

export function method(req, res, allowed) {
  if (!allowed.includes(req.method)) { res.setHeader('Allow', allowed.join(', ')); json(res,405,{error:'Method not allowed.'}); return false; }
  return true;
}

export async function writeAudit(client, actorId, action, targetType=null, targetId=null, metadata={}) {
  await client.from('audit_logs').insert({actor_id:actorId,action,target_type:targetType,target_id:targetId,metadata});
}
