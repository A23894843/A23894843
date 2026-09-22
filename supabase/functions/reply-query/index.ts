import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
}

const PERMISSIONS = new Set([
  'VIEW_DASHBOARD',
  'MANAGE_PROFILE',
  'MANAGE_DOCUMENTS',
  'VIEW_QUERIES',
  'REPLY_QUERIES',
  'MANAGE_ADMINS',
  'APPROVE_ADMINS',
  'VIEW_AUDIT_LOG',
])

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders })
}

function clean(value: unknown, max: number) {
  return String(value ?? '').trim().slice(0, max)
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  })[char]!)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return response({ error: 'Method not allowed.' }, 405)

  const authorization = req.headers.get('Authorization') || ''
  if (!authorization.startsWith('Bearer ')) {
    return response({ error: 'Authentication required.' }, 401)
  }

  const token = authorization.slice(7).trim()
  if (!token) return response({ error: 'Authentication required.' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const resendKey = Deno.env.get('RESEND_API_KEY')
  const emailFrom = Deno.env.get('EMAIL_FROM')

  if (!supabaseUrl || !serviceKey) {
    return response({ error: 'Supabase function configuration is incomplete.' }, 503)
  }
  if (!resendKey || !emailFrom) {
    return response({ error: 'Email service is not configured. Set RESEND_API_KEY and EMAIL_FROM in Supabase Edge Function secrets.' }, 503)
  }

  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

  const { data: userData, error: userError } = await adminClient.auth.getUser(token)
  const user = userData?.user
  if (userError || !user) return response({ error: 'Authentication required.' }, 401)

  const { data: profile, error: profileError } = await adminClient
    .from('profiles')
    .select('id,display_name,role,status')
    .eq('id', user.id)
    .single()

  if (profileError || !profile || profile.status !== 'approved' || !['owner', 'admin', 'support'].includes(profile.role)) {
    return response({ error: 'Approved admin access required.' }, 403)
  }

  const { data: permissionRows, error: permissionError } = await adminClient
    .from('admin_permissions')
    .select('permission')
    .eq('user_id', user.id)

  if (permissionError) return response({ error: 'Unable to verify permissions.' }, 500)

  const permissions = new Set((permissionRows || []).map((row) => row.permission))
  if (profile.role !== 'owner' && !permissions.has('REPLY_QUERIES')) {
    return response({ error: 'Reply permission required.' }, 403)
  }

  let payload: { id?: unknown; message?: unknown }
  try {
    payload = await req.json()
  } catch {
    return response({ error: 'Invalid JSON request.' }, 400)
  }

  const queryId = clean(payload.id, 100)
  const message = clean(payload.message, 8000)
  if (!queryId || !message) return response({ error: 'Query ID and reply message are required.' }, 400)

  const { data: query, error: queryError } = await adminClient
    .from('queries')
    .select('id,name,email,subject,status')
    .eq('id', queryId)
    .single()

  if (queryError || !query) return response({ error: 'Query not found.' }, 404)

  const html = `
<!doctype html>
<html>
<body style="margin:0;background:#f4f7f8;color:#15202b;font-family:Arial,Helvetica,sans-serif;line-height:1.6">
  <div style="max-width:680px;margin:32px auto;padding:0 18px">
    <div style="background:#10151c;color:#eef4f5;border-radius:16px;padding:28px">
      <div style="font-family:monospace;font-size:11px;letter-spacing:.14em;color:#42e3c4">ABHINANDAN PORTFOLIO</div>
      <h1 style="margin:14px 0 8px;font-size:24px">Reply to your query</h1>
      <p style="margin:0;color:#b9c3cc">${escapeHtml(query.subject)}</p>
    </div>
    <div style="background:#fff;border:1px solid #d7e0e5;border-radius:16px;padding:26px;margin-top:14px">
      <p>Hello ${escapeHtml(query.name)},</p>
      <div style="white-space:pre-wrap">${escapeHtml(message)}</div>
      <p style="margin-top:28px">Regards,<br><strong>Abhinandan</strong><br>Abhinandan Portfolio</p>
    </div>
  </div>
</body>
</html>`

  const emailResponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: emailFrom,
      to: [query.email],
      reply_to: emailFrom,
      subject: `Re: ${query.subject}`,
      html,
      text: `Hello ${query.name},\n\n${message}\n\nRegards,\nAbhinandan\nAbhinandan Portfolio`,
    }),
  })

  const emailResult = await emailResponse.json().catch(() => ({}))
  if (!emailResponse.ok) {
    await adminClient.from('query_replies').insert({
      query_id: query.id,
      admin_id: user.id,
      message,
      email_status: 'failed',
    })
    await adminClient.from('audit_logs').insert({
      admin_id: user.id,
      action: 'QUERY_REPLY_FAILED',
      target_type: 'query',
      target_id: query.id,
      metadata: { provider: 'resend', error: emailResult?.message || 'Email provider rejected the request.' },
    })
    return response({ error: emailResult?.message || 'Email delivery failed.' }, 502)
  }

  const { error: replyError } = await adminClient.from('query_replies').insert({
    query_id: query.id,
    admin_id: user.id,
    message,
    email_status: 'sent',
  })

  if (replyError) return response({ error: `Email sent, but reply history could not be stored: ${replyError.message}` }, 500)

  const { error: queryUpdateError } = await adminClient
    .from('queries')
    .update({ status: 'replied', updated_at: new Date().toISOString() })
    .eq('id', query.id)

  if (queryUpdateError) return response({ error: `Email sent and reply stored, but query status could not be updated: ${queryUpdateError.message}` }, 500)

  await adminClient.from('audit_logs').insert({
    admin_id: user.id,
    action: 'QUERY_REPLIED',
    target_type: 'query',
    target_id: query.id,
    metadata: { provider: 'resend', delivery_status: 'sent', provider_id: emailResult?.id || null },
  })

  return response({ ok: true, delivery_status: 'sent', provider_id: emailResult?.id || null })
})
