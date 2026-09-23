import nodemailer from 'nodemailer';
import {
  getAdminContext,
  json,
  method,
  hasPermission,
  writeAudit
} from '../../lib/admin-server.js';

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

export default async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;

  // Authenticate admin
  const ctx = await getAdminContext(req);

  if (!ctx) {
    return json(res, 401, {
      error: 'Admin authorization required.'
    });
  }

  // Check permission
  if (!hasPermission(ctx, 'REPLY_QUERIES')) {
    return json(res, 403, {
      error: 'Reply permission required.'
    });
  }

  const queryId = clean(req.body?.id, 100);
  const message = clean(req.body?.message, 8000);

  if (!queryId || !message) {
    return json(res, 400, {
      error: 'Query ID and reply message are required.'
    });
  }

  // SMTP configuration
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = Number(process.env.SMTP_PORT || 465);
  const smtpSecure =
    String(process.env.SMTP_SECURE || 'true').toLowerCase() !== 'false';

  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const emailFrom = process.env.EMAIL_FROM || smtpUser;

  if (!smtpHost || !smtpUser || !smtpPass || !emailFrom) {
    return json(res, 503, {
      error: 'SMTP email configuration is incomplete.'
    });
  }

  // Get query
  const {
    data: query,
    error: queryError
  } = await ctx.client
    .from('queries')
    .select('id,name,email,subject,message,status')
    .eq('id', queryId)
    .single();

  if (queryError || !query) {
    return json(res, 404, {
      error: 'Query not found.'
    });
  }

  // Create Gmail SMTP transporter
  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    auth: {
      user: smtpUser,
      pass: smtpPass
    }
  });

  // Verify SMTP configuration before sending
  try {
    await transporter.verify();
  } catch (error) {
    console.error('SMTP verification failed:', error);

    return json(res, 502, {
      error: 'Unable to connect to the configured SMTP server.'
    });
  }

  const html = `
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Reply to your query</title>
</head>

<body style="margin:0;background:#f4f7f8;color:#15202b;font-family:Arial,Helvetica,sans-serif;line-height:1.6">

  <div style="max-width:680px;margin:32px auto;padding:0 18px">

    <div style="background:#10151c;color:#eef4f5;border-radius:16px;padding:28px">

      <div style="
        font-family:monospace;
        font-size:11px;
        letter-spacing:.14em;
        color:#42e3c4;
      ">
        ABHINANDAN PORTFOLIO
      </div>

      <h1 style="margin:14px 0 8px;font-size:24px">
        Reply to your query
      </h1>

      <p style="margin:0;color:#b9c3cc">
        ${escapeHtml(query.subject)}
      </p>

    </div>

    <div style="
      background:#fff;
      border:1px solid #d7e0e5;
      border-radius:16px;
      padding:26px;
      margin-top:14px;
    ">

      <p>
        Hello ${escapeHtml(query.name)},
      </p>

      <div style="white-space:pre-wrap">
        ${escapeHtml(message)}
      </div>

      <p style="margin-top:28px">
        Regards,<br>
        <strong>Abhinandan</strong><br>
        Abhinandan Portfolio
      </p>

    </div>

  </div>

</body>
</html>
`;

  // Send email
  try {
    await transporter.sendMail({
      from: emailFrom,
      to: query.email,

      // When the visitor clicks Reply in their email client,
      // the response goes back to the portfolio Gmail account.
      replyTo: emailFrom,

      subject: `Re: ${query.subject}`,

      text:
`Hello ${query.name},

${message}

Regards,
Abhinandan
Abhinandan Portfolio`,

      html
    });
  } catch (error) {
    console.error('Email delivery failed:', error);

    // Record failed delivery
    await ctx.client
      .from('query_replies')
      .insert({
        query_id: query.id,
        admin_id: ctx.user.id,
        message,
        email_status: 'failed'
      });

    await writeAudit(
      ctx.client,
      ctx.user.id,
      'QUERY_REPLY_FAILED',
      'query',
      query.id,
      {
        provider: 'gmail-smtp',
        error: error?.message || 'SMTP delivery failed.'
      }
    );

    return json(res, 502, {
      error: 'Email delivery failed. Please check the Gmail SMTP configuration.'
    });
  }

  // Store successful reply
  const {
    error: replyError
  } = await ctx.client
    .from('query_replies')
    .insert({
      query_id: query.id,
      admin_id: ctx.user.id,
      message,
      email_status: 'sent'
    });

  if (replyError) {
    console.error('Reply history storage failed:', replyError);

    return json(res, 500, {
      error: `Email was sent, but reply history could not be stored: ${replyError.message}`
    });
  }

  // Update query status
  const {
    error: queryUpdateError
  } = await ctx.client
    .from('queries')
    .update({
      status: 'replied',
      updated_at: new Date().toISOString()
    })
    .eq('id', query.id);

  if (queryUpdateError) {
    console.error('Query status update failed:', queryUpdateError);

    return json(res, 500, {
      error: `Email was sent and stored, but query status could not be updated: ${queryUpdateError.message}`
    });
  }

  // Audit log
  await writeAudit(
    ctx.client,
    ctx.user.id,
    'QUERY_REPLIED',
    'query',
    query.id,
    {
      provider: 'gmail-smtp',
      delivery_status: 'sent'
    }
  );

  return json(res, 200, {
    ok: true,
    delivery_status: 'sent'
  });
}
