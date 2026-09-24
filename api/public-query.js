import nodemailer from 'nodemailer';
import { getServerClient, json, method } from '../lib/admin-server.js';

function clean(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[char]));
}

function createTransporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 465);
  const secure = String(process.env.SMTP_SECURE || 'true').toLowerCase() !== 'false';
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
}

export default async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;

  const { name, email, subject, message, turnstileToken, website } = req.body || {};

  if (clean(website, 100)) return json(res, 200, { ok: true, message: 'Thank you.' });

  if (!turnstileToken) {
    return json(res, 400, { error: 'CAPTCHA verification is required.' });
  }

  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    return json(res, 503, { error: 'CAPTCHA is not configured on the server.' });
  }

  const verification = await fetch(
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret,
        response: turnstileToken,
        remoteip: req.headers['x-forwarded-for']?.split(',')[0]?.trim()
      })
    }
  ).catch(() => null);

  const result = verification
    ? await verification.json().catch(() => null)
    : null;

  if (!result?.success || (result.action && result.action !== 'contact')) {
    return json(res, 403, { error: 'CAPTCHA verification failed. Please try again.' });
  }

  const n = clean(name, 100);
  const e = clean(email, 320);
  const s = clean(subject, 160);
  const m = clean(message, 8000);

  if (!n || !validEmail(e) || !s || !m) {
    return json(res, 400, { error: 'Please complete all fields with valid information.' });
  }

  const client = getServerClient();
  const windowStart = new Date(Date.now() - 10 * 60 * 1000).toISOString();

  const { count: recentCount } = await client
    .from('queries')
    .select('id', { count: 'exact', head: true })
    .eq('email', e)
    .gte('created_at', windowStart);

  if ((recentCount || 0) >= 5) {
    return json(res, 429, {
      error: 'Too many messages from this email. Please try again later.'
    });
  }

  const { data, error } = await client
    .from('queries')
    .insert({ name: n, email: e, subject: s, message: m })
    .select('id,created_at')
    .single();

  if (error) {
    console.error('Query storage failed:', error);
    return json(res, 500, { error: 'Unable to store your query.' });
  }

  // Query is stored first. SMTP failure does not lose the visitor's query.
  // Owner notification defaults to the portfolio owner email.
  const transporter = createTransporter();
  const notificationEmail =
    process.env.ADMIN_NOTIFICATION_EMAIL || 'a23894843@gmail.com';
  const emailFrom = process.env.EMAIL_FROM || process.env.SMTP_USER;
  const appBaseUrl =
    process.env.APP_BASE_URL || 'https://my-portfolio-abhinandan.vercel.app';

  if (transporter && notificationEmail && emailFrom) {
    const html = `
<!doctype html>
<html lang="en">
<body style="margin:0;background:#f4f7f8;color:#15202b;font-family:Arial,Helvetica,sans-serif;line-height:1.6">
  <div style="max-width:680px;margin:32px auto;padding:0 18px">
    <div style="background:#10151c;color:#eef4f5;border-radius:16px;padding:28px">
      <div style="font-family:monospace;font-size:11px;letter-spacing:.14em;color:#42e3c4">
        ABHINANDAN PORTFOLIO
      </div>
      <h1 style="margin:14px 0 8px;font-size:24px">New portfolio query</h1>
      <p style="margin:0;color:#b9c3cc">${escapeHtml(s)}</p>
    </div>
    <div style="background:#fff;border:1px solid #d7e0e5;border-radius:16px;padding:26px;margin-top:14px">
      <p><strong>From:</strong> ${escapeHtml(n)}</p>
      <p><strong>Email:</strong> ${escapeHtml(e)}</p>
      <p><strong>Subject:</strong> ${escapeHtml(s)}</p>
      <div style="margin-top:20px;padding:16px;background:#f4f7f8;border-radius:10px;white-space:pre-wrap">${escapeHtml(m)}</div>
      <p style="margin-top:24px">
        <a href="${escapeHtml(appBaseUrl)}/admin/queries.html"
           style="display:inline-block;padding:11px 16px;background:#42e3c4;color:#03120f;text-decoration:none;border-radius:8px">
          Open admin queries
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
        replyTo: e,
        subject: `[New Query] ${s}`,
        text: `New portfolio query

From: ${n}
Email: ${e}
Subject: ${s}

${m}

Open admin queries:
${appBaseUrl}/admin/queries.html`,
        html
      });
    } catch (notificationError) {
      console.error('New-query notification failed:', notificationError);
    }
  } else {
    console.error('New-query notification skipped: SMTP configuration is incomplete.');
  }

  return json(res, 201, {
    ok: true,
    id: data.id,
    message: 'Your query has been received. Thank you.'
  });
}
