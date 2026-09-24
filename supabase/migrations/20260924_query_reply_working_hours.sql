-- Query reply scheduling upgrade for the rebuilt application schema.
-- Replies are queued by the admin API and delivered by Vercel Cron during working hours.

alter table public.query_replies
  add column if not exists scheduled_at timestamptz,
  add column if not exists sent_at timestamptz,
  add column if not exists error_message text;

-- The rebuilt database uses email_status. Allow queued replies in addition to sent/failed.
alter table public.query_replies drop constraint if exists query_replies_email_status_check;
alter table public.query_replies add constraint query_replies_email_status_check
  check (email_status in ('queued','sent','failed','stored'));

create index if not exists query_replies_queue_idx
  on public.query_replies(email_status, scheduled_at);

create index if not exists queries_status_created_idx
  on public.queries(status, created_at);
