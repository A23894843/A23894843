import nodemailer from 'nodemailer';
import { getServerClient, json, method, writeAudit } from '../../lib/admin-server.js';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[c]));
}

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && req.headers.authorization === `Bearer ${secret}`);
}

function transporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 465);
  const secure = String(process.env.SMTP_SECURE || 'true').toLowerCase() !== 'false';
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
}

export default async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;
  if (!authorized(req)) return json(res, 401, { error: 'Unauthorized.' });

  const client = getServerClient();
  const mailer = transporter();
  const from = process.env.EMAIL_FROM || process.env.SMTP_USER;
  if (!mailer || !from) return json(res, 503, { error: 'SMTP email configuration is incomplete.' });

  const now = new Date().toISOString();
  const { data: replies, error } = await client
    .from('query_replies')
    .select('id,query_id,admin_id,message,scheduled_at,created_at,queries(id,name,email,subject,message)')
    .eq('email_status', 'queued')
    .lte('scheduled_at', now)
    .order('scheduled_at', { ascending: true })
    .limit(50);

  if (error) {
    console.error('Reply queue lookup failed:', error);
    return json(res, 500, { error: 'Unable to load queued replies.' });
  }

  let sent = 0, failed = 0;
  for (const reply of replies || []) {
    const query = Array.isArray(reply.queries) ? reply.queries[0] : reply.queries;
    if (!query) {
      await client.from('query_replies').update({ email_status: 'failed', error_message: 'Original query not found.' }).eq('id', reply.id);
      failed++;
      continue;
    }

    const html = `<!doctype html><html><body style="margin:0;background:#f4f7f8;color:#15202b;font-family:Arial,Helvetica,sans-serif;line-height:1.6"><div style="max-width:680px;margin:32px auto;padding:0 18px"><div style="background:#10151c;color:#eef4f5;border-radius:16px;padding:28px"><div style="font-family:monospace;font-size:11px;letter-spacing:.14em;color:#42e3c4">ABHINANDAN PORTFOLIO</div><h1 style="margin:14px 0 8px;font-size:24px">Reply to your query</h1><p style="margin:0;color:#b9c3cc">${escapeHtml(query.subject)}</p></div><div style="background:#fff;border:1px solid #d7e0e5;border-radius:16px;padding:26px;margin-top:14px"><p>Hello ${escapeHtml(query.name)},</p><div style="white-space:pre-wrap">${escapeHtml(reply.message)}</div><p style="margin-top:28px">Regards,<br><strong>Abhinandan</strong><br>Abhinandan Portfolio</p></div></div></body></html>`;

    try {
      await mailer.sendMail({
        from,
        to: query.email,
        replyTo: from,
        subject: `Re: ${query.subject}`,
        text: `Hello ${query.name},\n\n${reply.message}\n\nRegards,\nAbhinandan\nAbhinandan Portfolio`,
        html
      });

      await client.from('query_replies').update({ email_status: 'sent', sent_at: new Date().toISOString(), error_message: null }).eq('id', reply.id);
      await client.from('queries').update({ status: 'replied', updated_at: new Date().toISOString() }).eq('id', query.id);
      await writeAudit(client, reply.admin_id, 'QUERY_REPLY_SENT', 'query', query.id, { reply_id: reply.id, provider: 'gmail-smtp' });
      sent++;
    } catch (sendError) {
      console.error('Queued reply failed:', sendError);
      await client.from('query_replies').update({ email_status: 'failed', error_message: String(sendError?.message || 'SMTP delivery failed.').slice(0, 1000) }).eq('id', reply.id);
      await writeAudit(client, reply.admin_id, 'QUERY_REPLY_FAILED', 'query', query.id, { reply_id: reply.id, provider: 'gmail-smtp', error: String(sendError?.message || 'SMTP delivery failed.').slice(0, 500) });
      failed++;
    }
  }

  return json(res, 200, { ok: true, checked: replies?.length || 0, sent, failed });
}
