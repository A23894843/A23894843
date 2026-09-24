import nodemailer from 'nodemailer';

import {
  getServerClient,
  json,
  method,
  writeAudit
} from '../../lib/admin-server.js';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
}

function authorized(req) {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return false;
  }

  return req.headers.authorization === `Bearer ${secret}`;
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

async function processQueuedReplies(client, mailer, from) {
  const now = new Date().toISOString();

  const {
    data: replies,
    error
  } = await client
    .from('query_replies')
    .select(`
      id,
      query_id,
      admin_id,
      message,
      scheduled_at,
      created_at,
      queries(
        id,
        name,
        email,
        subject,
        message
      )
    `)
    .eq('email_status', 'queued')
    .lte('scheduled_at', now)
    .order('scheduled_at', {
      ascending: true
    })
    .limit(50);

  if (error) {
    console.error(
      'QUERY_QUEUE_LOOKUP_FAILED',
      error
    );

    return {
      checked: 0,
      sent: 0,
      failed: 1
    };
  }

  let sent = 0;
  let failed = 0;

  for (const reply of replies || []) {
    const query = Array.isArray(reply.queries)
      ? reply.queries[0]
      : reply.queries;

    if (!query) {
      await client
        .from('query_replies')
        .update({
          email_status: 'failed',
          error_message:
            'Original query not found.'
        })
        .eq('id', reply.id);

      failed++;
      continue;
    }

    const html = `
<!doctype html>
<html lang="en">

<head>
  <meta charset="utf-8">
  <title>Reply to your query</title>
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
        Reply to your query
      </h1>

      <p
        style="
          margin:0;
          color:#b9c3cc;
        "
      >
        ${escapeHtml(query.subject)}
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
        Hello ${escapeHtml(query.name)},
      </p>

      <div
        style="
          white-space:pre-wrap;
        "
      >
        ${escapeHtml(reply.message)}
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

    try {
      const result = await mailer.sendMail({
        from,
        to: query.email,
        replyTo: from,
        subject: `Re: ${query.subject}`,

        text:
`Hello ${query.name},

${reply.message}

Regards,
Abhinandan
Abhinandan Portfolio`,

        html
      });

      await client
        .from('query_replies')
        .update({
          email_status: 'sent',
          sent_at: new Date().toISOString(),
          error_message: null
        })
        .eq('id', reply.id);

      await client
        .from('queries')
        .update({
          status: 'replied',
          updated_at: new Date().toISOString()
        })
        .eq('id', query.id);

      await writeAudit(
        client,
        reply.admin_id,
        'QUERY_REPLY_SENT',
        'query',
        query.id,
        {
          reply_id: reply.id,
          provider: 'gmail-smtp',
          message_id: result?.messageId || null
        }
      );

      sent++;

    } catch (error) {

      console.error(
        'QUEUED_REPLY_FAILED',
        {
          replyId: reply.id,
          queryId: query.id,
          code: error?.code || null,
          responseCode:
            error?.responseCode || null,
          message:
            error?.message || null
        }
      );

      await client
        .from('query_replies')
        .update({
          email_status: 'failed',
          error_message:
            String(
              error?.message ||
              'SMTP delivery failed.'
            ).slice(0, 1000)
        })
        .eq('id', reply.id);

      await writeAudit(
        client,
        reply.admin_id,
        'QUERY_REPLY_FAILED',
        'query',
        query.id,
        {
          reply_id: reply.id,
          provider: 'gmail-smtp',
          error: String(
            error?.message ||
            'SMTP delivery failed.'
          ).slice(0, 500)
        }
      );

      failed++;
    }
  }

  return {
    checked: replies?.length || 0,
    sent,
    failed
  };
}

async function process24HourReminders(
  client,
  mailer,
  from,
  notificationEmail
) {
  const cutoff = new Date(
    Date.now() - 24 * 60 * 60 * 1000
  ).toISOString();

  const {
    data: queries,
    error
  } = await client
    .from('queries')
    .select(
      'id,name,email,subject,message,status,created_at'
    )
    .in('status', ['new', 'read'])
    .lte('created_at', cutoff)
    .order('created_at', {
      ascending: true
    })
    .limit(50);

  if (error) {
    console.error(
      'QUERY_REMINDER_LOOKUP_FAILED',
      error
    );

    return {
      checked: 0,
      sent: 0,
      skipped: 0,
      failed: 1
    };
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const query of queries || []) {

    const {
      data: existingReminder,
      error: auditLookupError
    } = await client
      .from('audit_logs')
      .select('id')
      .eq(
        'action',
        'QUERY_24H_REMINDER_SENT'
      )
      .eq(
        'target_type',
        'query'
      )
      .eq(
        'target_id',
        String(query.id)
      )
      .limit(1)
      .maybeSingle();

    if (auditLookupError) {
      console.error(
        'REMINDER_AUDIT_LOOKUP_FAILED',
        auditLookupError
      );

      failed++;
      continue;
    }

    if (existingReminder) {
      skipped++;
      continue;
    }

    const hoursWaiting = Math.max(
      24,
      Math.floor(
        (
          Date.now() -
          new Date(
            query.created_at
          ).getTime()
        ) / 3600000
      )
    );

    const html = `
<!doctype html>
<html lang="en">

<head>
  <meta charset="utf-8">
  <title>24-hour Query Reminder</title>
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
        24-hour query reminder
      </h1>

      <p
        style="
          margin:0;
          color:#b9c3cc;
        "
      >
        A query is still waiting for a reply.
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
        <strong>Waiting:</strong>
        about ${hoursWaiting} hours
      </p>

      <p>
        <strong>From:</strong>
        ${escapeHtml(query.name)}
      </p>

      <p>
        <strong>Email:</strong>
        ${escapeHtml(query.email)}
      </p>

      <p>
        <strong>Subject:</strong>
        ${escapeHtml(query.subject)}
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
        ${escapeHtml(query.message)}
      </div>

      <p style="margin-top:24px">

        <a
          href="https://my-portfolio-abhinandan.vercel.app/admin/queries.html"
          style="
            display:inline-block;
            padding:11px 16px;
            background:#42e3c4;
            color:#03120f;
            text-decoration:none;
            border-radius:8px;
          "
        >
          Reply to query
        </a>

      </p>

    </div>

  </div>

</body>
</html>
`;

    try {

      await mailer.sendMail({
        from,
        to: notificationEmail,
        replyTo: query.email,

        subject:
          `[24h Reminder] Query awaiting reply — ${query.subject}`,

        text:
`24-hour query reminder

A query is still waiting for a reply.

Waiting: about ${hoursWaiting} hours
From: ${query.name}
Email: ${query.email}
Subject: ${query.subject}

${query.message}

Reply from:
https://my-portfolio-abhinandan.vercel.app/admin/queries.html`,

        html
      });

      await client
        .from('audit_logs')
        .insert({
          admin_id: null,
          action:
            'QUERY_24H_REMINDER_SENT',
          target_type: 'query',
          target_id:
            String(query.id),
          metadata: {
            notification: 'email',
            provider: 'gmail-smtp'
          }
        });

      sent++;

    } catch (error) {

      console.error(
        'QUERY_24H_REMINDER_FAILED',
        {
          queryId: query.id,
          code: error?.code || null,
          responseCode:
            error?.responseCode || null,
          message:
            error?.message || null
        }
      );

      failed++;
    }
  }

  return {
    checked: queries?.length || 0,
    sent,
    skipped,
    failed
  };
}

export default async function handler(
  req,
  res
) {
  if (!method(req, res, ['GET'])) {
    return;
  }

  if (!authorized(req)) {
    return json(res, 401, {
      error: 'Unauthorized.'
    });
  }

  const client = getServerClient();

  const mailer = createTransporter();

  const from =
    process.env.EMAIL_FROM ||
    process.env.SMTP_USER;

  const notificationEmail =
    process.env.ADMIN_NOTIFICATION_EMAIL ||
    'a23894843@gmail.com';

  if (!mailer || !from) {
    return json(res, 503, {
      error:
        'SMTP email configuration is incomplete.'
    });
  }

  console.log(
    'QUERY_SCHEDULER_STARTED',
    {
      timestamp:
        new Date().toISOString()
    }
  );

  const queuedReplies =
    await processQueuedReplies(
      client,
      mailer,
      from
    );

  const reminders =
    await process24HourReminders(
      client,
      mailer,
      from,
      notificationEmail
    );

  console.log(
    'QUERY_SCHEDULER_COMPLETED',
    {
      queuedReplies,
      reminders
    }
  );

  return json(res, 200, {
    ok: true,
    queued_replies: queuedReplies,
    reminders
  });
}
