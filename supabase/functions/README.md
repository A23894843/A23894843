# Supabase Edge Functions

This package moves query-reply email delivery from the Vercel API to Supabase Edge Functions.

## Function

`reply-query` sends a reply through Resend, stores `query_replies.email_status`, updates the query to `replied`, and writes an audit entry. It validates the caller's Supabase Auth JWT and `REPLY_QUERIES` permission server-side.

## Production secrets

Set these in Supabase Edge Function Secrets:

- `RESEND_API_KEY`
- `EMAIL_FROM` — a sender address/domain authorized by Resend

Supabase automatically provides the function with its project URL and service-role credential. Do not put any secret in frontend code.

## Deploy

```bash
supabase functions deploy reply-query
```

The current admin Queries page calls this function with `sb.functions.invoke('reply-query', ...)`.
