import nodemailer from 'nodemailer';
import { getServerClient, json, method } from '../../lib/admin-server.js';

function clean(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
}

function createTransporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 465);
  const secure = String(process.env.SMTP_SECURE || 'true').toLowerCase() !== 'false';
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) return null;

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass }
  });
}

function authorized(req) {
  const secret = process.env.CRON_SECRET;

  if (!secret) return false;

  const authorization = req.headers.authorization || '';
  return authorization === `Bearer ${secret}`;
}

export default async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;

  if (!authorized(req)) {
    return json(res, 401, { error: 'Unauthorized.' });
  }

  const transporter = createTransporter();
  const notificationEmail =
    process.env.ADMIN_NOTIFICATION_EMAIL || process.env.SMTP_USER;
  const emailFrom =
    process.env.EMAIL_FROM || process.env.SMTP_USER;
  const appBaseUrl =
    process.env.APP_BASE_URL || 'https://my-portfolio-abhinandan.vercel.app';

  if (!transporter || !notificationEmail || !emailFrom) {
    return json(res, 503, {
      error: 'SMTP notification configuration is incomplete.'
    });
  }

  const client = getServerClient();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: queries, error } = await client
    .from('queries')
    .select('id,name,email,subject,message,status,created_at')
    .in('status', ['new', 'read'])
    .lte('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(50);

  if (error) {
    console.error('24h reminder query failed:', error);
    return json(res, 500, { error: 'Unable to find pending reminders.' });
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const query of queries || []) {
    const { data: existingReminder, error: auditLookupError } = await client
      .from('audit_logs')
      .select('id')
      .eq('action', 'QUERY_24H_REMINDER_SENT')
      .eq('target_type', 'query')
      .eq('target_id', String(query.id))
      .limit(1)
      .maybeSingle();

    if (auditLookupError) {
      console.error('Reminder audit lookup failed:', auditLookupError);
      failed++;
      continue;
    }

    if (existingReminder) {
      skipped++;
      continue;
    }

    const hoursWaiting = Math.max(
      24,
      Math.floor((Date.now() - new Date(query.created_at).getTime()) / 3600000)
    );

    const html = `
<!doctype html>
<html lang="en">
<body style="margin:0;background:#f4f7f8;color:#15202b;font-family:Arial,Helvetica,sans-serif;line-height:1.6">
  <div style="max-width:680px;margin:32px auto;padding:0 18px">
    <div style="background:#10151c;color:#eef4f5;border-radius:16px;padding:28px">
      <div style="font-family:monospace;font-size:11px;letter-spacing:.14em;color:#42e3c4">
        ABHINANDAN PORTFOLIO
      </div>
      <h1 style="margin:14px 0 8px;font-size:24px">24-hour query reminder</h1>
      <p style="margin:0;color:#b9c3cc">A query is still waiting for a reply.</p>
    </div>
    <div style="background:#fff;border:1px solid #d7e0e5;border-radius:16px;padding:26px;margin-top:14px">
      <p><strong>Waiting:</strong> about ${hoursWaiting} hours</p>
      <p><strong>From:</strong> ${escapeHtml(query.name)}</p>
      <p><strong>Email:</strong> ${escapeHtml(query.email)}</p>
      <p><strong>Subject:</strong> ${escapeHtml(query.subject)}</p>
      <div style="margin-top:20px;padding:16px;background:#f4f7f8;border-radius:10px;white-space:pre-wrap">${escapeHtml(query.message)}</div>
      <p style="margin-top:24px">
        <a href="${escapeHtml(appBaseUrl)}/admin/queries.html"
           style="display:inline-block;padding:11px 16px;background:#42e3c4;color:#03120f;text-decoration:none;border-radius:8px">
          Reply to query
        </a>
      </p>
    </div>
  </div>
</body>
</html>`;

    try {
      await transporter.sendMail({
        from: emailFrom,
        to: notificationEmail,
        replyTo: query.email,
        subject: `[24h Reminder] Query awaiting reply — ${query.subject}`,
        text:
`24-hour query reminder

A query is still waiting for a reply.

Waiting: about ${hoursWaiting} hours
From: ${query.name}
Email: ${query.email}
Subject: ${query.subject}

${query.message}

Reply from:
${appBaseUrl}/admin/queries.html`,
        html
      });

      const { error: auditError } = await client
        .from('audit_logs')
        .insert({
          admin_id: null,
          action: 'QUERY_24H_REMINDER_SENT',
          target_type: 'query',
          target_id: String(query.id),
          metadata: {
            notification: 'email',
            provider: 'gmail-smtp'
          }
        });

      if (auditError) {
        console.error('Reminder audit insert failed:', auditError);
        failed++;
        continue;
      }

      sent++;
    } catch (sendError) {
      console.error('24h reminder email failed:', sendError);
      failed++;
    }
  }

  return json(res, 200, {
    ok: true,
    sent,
    skipped,
    failed,
    checked: queries?.length || 0
  });
}
