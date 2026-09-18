# Abhinandan Portfolio v4
Pages:
- `/` public portfolio
- `/guest/documents.html` recruiter document room, no login
- `/admin/login.html` admin login
- `/admin/signup.html` admin registration request
- `/admin/documents.html` protected document manager

Authentication uses Supabase Auth plus a separate `profiles` authorization table. Signup creates `pending`, not active admin access. An existing approved admin must approve the account.

Documents use a private Supabase Storage bucket. CV can be `download_allowed=true`; reports/certificates can be preview-only. A preview-only browser document cannot be made DRM-proof.

Setup:
1. Create Supabase project and enable email/password.
2. Run `supabase/schema.sql`.
3. Put project URL + ANON key into `admin/config.js`.
4. Register first admin.
5. Approve first admin in SQL:
   `UPDATE public.profiles SET status='approved' WHERE id='AUTH_USER_UUID';`
6. Add a trusted server/Edge Function for public short-lived signed preview URLs. Never expose the Supabase service-role key in browser code.

OWASP recommends secure password storage, HTTPS, secure sessions, and server-side authorization.
