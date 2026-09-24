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

function nextWorkingTime(from = new Date()) {
  const tz = process.env.WORKING_TIMEZONE || 'Asia/Kolkata';
  const start = process.env.WORKING_HOURS_START || '09:00';
  const end = process.env.WORKING_HOURS_END || '18:00';
  const days = (process.env.WORKING_DAYS || '1,2,3,4,5').split(',').map(Number).filter(Boolean);
  const [startHour, startMinute] = start.split(':').map(Number);
  const [endHour, endMinute] = end.split(':').map(Number);

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(from).reduce((o, p) => ((o[p.type] = p.value), o), {});

  const local = new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second));

  // Asia/Kolkata is UTC+05:30 and is the configured default. For a configurable timezone,
  // scheduled values are computed by testing UTC candidates against the local timezone.
  for (let i = 0; i < 14; i++) {
    const candidateDay = new Date(local);
    candidateDay.setUTCDate(local.getUTCDate() + i);
    const day = candidateDay.getUTCDay() || 7; // Monday=1 ... Sunday=7
    if (!days.includes(day)) continue;

    const startLocal = new Date(candidateDay);
    startLocal.setUTCHours(startHour, startMinute, 0, 0);
    const endLocal = new Date(candidateDay);
    endLocal.setUTCHours(endHour, endMinute, 0, 0);

    if (i === 0 && local < endLocal && local >= startLocal) {
      return from.toISOString();
    }
    if (i === 0 && local < startLocal) {
      return new Date(startLocal.getTime() - 330 * 60 * 1000).toISOString();
    }
    if (i > 0) {
      return new Date(startLocal.getTime() - 330 * 60 * 1000).toISOString();
    }
  }
  throw new Error('No working time could be calculated.');
}

export default async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;

  const ctx = await getAdminContext(req);
  if (!ctx) return json(res, 401, { error: 'Admin authorization required.' });
  if (!hasPermission(ctx, 'REPLY_QUERIES')) {
    return json(res, 403, { error: 'Reply permission required.' });
  }

  const queryId = clean(req.body?.id, 100);
  const message = clean(req.body?.message, 8000);
  if (!queryId || !message) {
    return json(res, 400, { error: 'Query ID and reply message are required.' });
  }

  const { data: query, error: queryError } = await ctx.client
    .from('queries')
    .select('id,name,email,subject,message,status')
    .eq('id', queryId)
    .single();

  if (queryError || !query) return json(res, 404, { error: 'Query not found.' });
  if (query.status === 'closed') return json(res, 409, { error: 'This query is closed.' });

  let scheduledAt;
  try {
    scheduledAt = nextWorkingTime();
  } catch (error) {
    console.error('Working-hours calculation failed:', error);
    return json(res, 500, { error: 'Unable to calculate the reply schedule.' });
  }

  const { data: reply, error: replyError } = await ctx.client
    .from('query_replies')
    .insert({
      query_id: query.id,
      admin_id: ctx.user.id,
      message,
      email_status: 'queued',
      scheduled_at: scheduledAt
    })
    .select('id,scheduled_at')
    .single();

  if (replyError) {
    console.error('Reply queue insert failed:', replyError);
    return json(res, 500, { error: `Unable to queue reply: ${replyError.message}` });
  }

  await ctx.client.from('queries').update({
    status: 'read',
    updated_at: new Date().toISOString()
  }).eq('id', query.id);

  await writeAudit(ctx.client, ctx.user.id, 'QUERY_REPLY_QUEUED', 'query', query.id, {
    reply_id: reply.id,
    scheduled_at: scheduledAt,
    timezone: process.env.WORKING_TIMEZONE || 'Asia/Kolkata'
  });

  const scheduledDate = new Date(scheduledAt);
  const isImmediate = scheduledDate.getTime() <= Date.now() + 1000;

  return json(res, 200, {
    ok: true,
    delivery_status: 'queued',
    scheduled_at: scheduledAt,
    message: isImmediate
      ? 'Reply queued for immediate delivery during working hours.'
      : `Reply scheduled for ${scheduledDate.toLocaleString('en-IN', { timeZone: process.env.WORKING_TIMEZONE || 'Asia/Kolkata' })}.`
  });
}
