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
  const secure =
    String(process.env.SMTP_SECURE || 'true').toLowerCase() !== 'false';

  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user,
      pass
    }
  });
}

export default async function handler(req, res) {
  if (!method(req, res, ['POST'])) {
    return;
  }

  const {
    name,
    email,
    subject,
    message,
    turnstileToken,
    website
  } = req.body || {};

  // Honeypot protection.
  if (clean(website, 100)) {
    return json(res, 200, {
      ok: true,
      message: 'Thank you.'
    });
  }

  // CAPTCHA must be present.
  if (!turnstileToken) {
    return json(res, 400, {
      error: 'CAPTCHA verification is required.'
    });
  }

  const secret = process.env.TURNSTILE_SECRET_KEY;

  if (!secret) {
    return json(res, 503, {
      error: 'CAPTCHA is not configured on the server.'
    });
  }

  // Verify Cloudflare Turnstile.
  const verification = await fetch(
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        secret,
        response: turnstileToken,
        remoteip: req.headers['x-forwarded-for']
          ?.split(',')[0]
          ?.trim()
      })
    }
  ).catch(() => null);

  const result = verification
    ? await verification.json().catch(() => null)
    : null;

  if (
    !result?.success ||
    (result.action && result.action !== 'contact')
  ) {
    return json(res, 403, {
      error: 'CAPTCHA verification failed. Please try again.'
    });
  }

  // Clean input.
  const n = clean(name, 100);
  const e = clean(email, 320);
  const s = clean(subject, 160);
  const m = clean(message, 8000);

  if (!n || !validEmail(e) || !s || !m) {
    return json(res, 400, {
      error: 'Please complete all fields with valid information.'
    });
  }

  const client = getServerClient();

  // Basic rate limit:
  // Maximum 5 queries from the same email in 10 minutes.
  const windowStart = new Date(
    Date.now() - 10 * 60 * 1000
  ).toISOString();

  const { count: recentCount } = await client
    .from('queries')
    .select('id', {
      count: 'exact',
      head: true
    })
    .eq('email', e)
    .gte('created_at', windowStart);

  if ((recentCount || 0) >= 5) {
    return json(res, 429, {
      error: 'Too many messages from this email. Please try again later.'
    });
  }

  // ------------------------------------------------------------
  // STEP 1: Store query in Supabase
  // ------------------------------------------------------------

  const { data, error } = await client
    .from('queries')
    .insert({
      name: n,
      email: e,
      subject: s,
      message: m
    })
    .select('id,created_at')
    .single();

  if (error) {
    console.error('QUERY_STORAGE_FAILED', {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint
    });

    return json(res, 500, {
      error: 'Unable to store your query.'
    });
  }

  // ------------------------------------------------------------
  // STEP 2: Owner notification
  //
  // Visitor does NOT receive an automatic email.
  // Owner receives the notification.
  // ------------------------------------------------------------

  const notificationEmail =
    process.env.ADMIN_NOTIFICATION_EMAIL ||
    'a23894843@gmail.com';

  const emailFrom =
    process.env.EMAIL_FROM ||
    process.env.SMTP_USER;

  const appBaseUrl =
    process.env.APP_BASE_URL ||
    'https://my-portfolio-abhinandan.vercel.app';

  // Safe diagnostic information.
  // NEVER logs SMTP_PASS.
  console.log('QUERY_OWNER_EMAIL_DIAGNOSTIC', {
    queryId: data.id,

    smtpHost:
      process.env.SMTP_HOST || null,

    smtpPort:
      Number(process.env.SMTP_PORT || 465),

    smtpSecure:
      String(
        process.env.SMTP_SECURE || 'true'
      ).toLowerCase() !== 'false',

    smtpUserConfigured:
      Boolean(process.env.SMTP_USER),

    smtpPasswordConfigured:
      Boolean(process.env.SMTP_PASS),

    emailFromConfigured:
      Boolean(emailFrom),

    notificationEmail,

    smtpConfigured:
      Boolean(
        process.env.SMTP_HOST &&
        process.env.SMTP_USER &&
        process.env.SMTP_PASS
      )
  });

  const transporter = createTransporter();

  if (
    !transporter ||
    !emailFrom ||
    !notificationEmail
  ) {
    console.error('QUERY_OWNER_EMAIL_SKIPPED', {
      reason:
        'SMTP configuration is incomplete',

      emailFromConfigured:
        Boolean(emailFrom),

      notificationEmailConfigured:
        Boolean(notificationEmail)
    });

    // Query is already stored.
    return json(res, 201, {
      ok: true,
      id: data.id,
      message:
        'Your query has been received. Thank you.',
      notification: 'not_sent'
    });
  }

  // ------------------------------------------------------------
  // Owner notification email
  // ------------------------------------------------------------

  const html = `
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>New Portfolio Query</title>
</head>

<body
  style="
    margin:0;
    background:#f4f7f8;
    color:#15202b;
    font-family:Arial,Helvetica,sans-serif;
    line-height:1.6;
  "
>

  <div
    style="
      max-width:680px;
      margin:32px auto;
      padding:0 18px;
    "
  >

    <div
      style="
        background:#10151c;
        color:#eef4f5;
        border-radius:16px;
        padding:28px;
      "
    >

      <div
        style="
          font-family:monospace;
          font-size:11px;
          letter-spacing:.14em;
          color:#42e3c4;
        "
      >
        ABHINANDAN PORTFOLIO
      </div>

      <h1
        style="
          margin:14px 0 8px;
          font-size:24px;
        "
      >
        New portfolio query
      </h1>

      <p
        style="
          margin:0;
          color:#b9c3cc;
        "
      >
        ${escapeHtml(s)}
      </p>

    </div>

    <div
      style="
        background:#fff;
        border:1px solid #d7e0e5;
        border-radius:16px;
        padding:26px;
        margin-top:14px;
      "
    >

      <p>
        <strong>From:</strong>
        ${escapeHtml(n)}
      </p>

      <p>
        <strong>Email:</strong>
        ${escapeHtml(e)}
      </p>

      <p>
        <strong>Subject:</strong>
        ${escapeHtml(s)}
      </p>

      <div
        style="
          margin-top:20px;
          padding:16px;
          background:#f4f7f8;
          border-radius:10px;
          white-space:pre-wrap;
        "
      >
        ${escapeHtml(m)}
      </div>

      <p style="margin-top:24px">

        <a
          href="${escapeHtml(
            appBaseUrl
          )}/admin/queries.html"

          style="
            display:inline-block;
            padding:11px 16px;
            background:#42e3c4;
            color:#03120f;
            text-decoration:none;
            border-radius:8px;
          "
        >
          Open admin queries
        </a>

      </p>

    </div>

  </div>

</body>
</html>
`;

  // ------------------------------------------------------------
  // STEP 3: Send email
  // ------------------------------------------------------------

  try {
    const mailResult =
      await transporter.sendMail({

        from: emailFrom,

        // OWNER ONLY
        to: notificationEmail,

        // Allows owner to press Reply and reply
        // directly to the visitor.
        replyTo: e,

        subject:
          `[New Query] ${s}`,

        text:
`New portfolio query

From: ${n}
Email: ${e}
Subject: ${s}

${m}

Open admin queries:
${appBaseUrl}/admin/queries.html`,

        html
      });

    // Safe diagnostic information.
    console.log(
      'QUERY_OWNER_EMAIL_SENT',
      {
        queryId: data.id,

        messageId:
          mailResult?.messageId ||
          null,

        accepted:
          mailResult?.accepted ||
          [],

        rejected:
          mailResult?.rejected ||
          [],

        response:
          mailResult?.response ||
          null
      }
    );

    return json(res, 201, {
      ok: true,
      id: data.id,
      message:
        'Your query has been received. Thank you.',
      notification: 'sent'
    });

  } catch (notificationError) {

    // Safe diagnostic information.
    // SMTP password is NEVER logged.
    console.error(
      'QUERY_OWNER_EMAIL_FAILED',
      {
        queryId: data.id,

        name:
          notificationError?.name ||
          null,

        code:
          notificationError?.code ||
          null,

        responseCode:
          notificationError?.responseCode ||
          null,

        command:
          notificationError?.command ||
          null,

        response:
          notificationError?.response ||
          null,

        message:
          notificationError?.message ||
          null
      }
    );

    // IMPORTANT:
    // Query remains stored in Supabase even if
    // email delivery fails.
    return json(res, 201, {
      ok: true,
      id: data.id,
      message:
        'Your query has been received. Thank you.',
      notification: 'failed'
    });
  }
}
