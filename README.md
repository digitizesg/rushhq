# Rush HQ

Login-only family operations site for the Rush family. Calendar plus
auth/admin/settings shell that the next modules (beads, stocks,
finance) will plug into.

Read [CLAUDE.md](./CLAUDE.md) for architecture, conventions, and
guardrails before changing code.

## Setup runbook

Numbered steps so it's clear what's done and what's left. Fresh-machine
setup walks through all 12. Steps 1–6 are completed by this initial
scaffold; 7–12 are what bringing the app online needs.

### 1. Install prerequisites

- Node 22 LTS (`nvm install 22 && nvm use 22`)
- pnpm or npm — pick one and stick with it (this project uses npm)
- Supabase CLI: `brew install supabase/tap/supabase`
- Vercel CLI: `npm i -g vercel`
- Telegram bot already created as `@RushFamilyBot` (token in 1Password)

### 2. Clone the repo and install web deps

```bash
git clone <repo-url>
cd rushhq/apps/web
npm install
```

### 3. Create the Supabase project

Already done — the project exists and email signup is disabled.
Resend is wired up as the custom SMTP provider for auth emails.

### 4. Link the local CLI to the project

```bash
cd rushhq
supabase login
supabase link --project-ref <your-project-ref>
```

### 5. Apply migrations

```bash
supabase db push
```

This applies all three migrations:

- `0001_foundation.sql` — tables, enums, RLS, helper functions
- `0002_dispatch_helpers.sql` — `fetch_dispatch_candidates(...)`
- `0003_schedule_dispatcher.sql` — pg_cron + pg_net schedule

### 6. Set the database GUCs the cron job depends on

In the Supabase SQL editor:

```sql
alter database postgres set "app.settings.supabase_url"
  = 'https://YOUR_PROJECT_REF.supabase.co';
alter database postgres set "app.settings.service_role_key"
  = 'YOUR_SERVICE_ROLE_KEY';
```

Without these, the pg_cron job that hits `/functions/v1/dispatch-reminders`
silently returns 401.

### 7. Set edge-function secrets

```bash
supabase secrets set \
  SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=... \
  TELEGRAM_BOT_TOKEN=... \
  TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 32) \
  TELEGRAM_BOT_USERNAME=RushFamilyBot \
  RESEND_API_KEY=re_... \
  APP_URL=https://rushhq.co \
  FROM_EMAIL='Rush HQ <hello@rushhq.co>'
```

Save the `TELEGRAM_WEBHOOK_SECRET` value — you'll re-use it in step 8.

### 8. Deploy edge functions and register the Telegram webhook

```bash
supabase functions deploy dispatch-reminders
supabase functions deploy telegram-webhook --no-verify-jwt
```

`telegram-webhook` deploys with `--no-verify-jwt` because Telegram
won't carry our Supabase JWT — we authenticate via the secret-token
header instead.

Then point Telegram at the function:

```bash
curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H 'content-type: application/json' \
  -d "{
    \"url\": \"https://YOUR_PROJECT_REF.supabase.co/functions/v1/telegram-webhook\",
    \"secret_token\": \"${TELEGRAM_WEBHOOK_SECRET}\",
    \"allowed_updates\": [\"message\"]
  }"
```

### 9. Seed the initial family members

In the Supabase SQL editor (replace the `auth.users` UUIDs once you've
created the auth users in step 11):

```sql
insert into family_members (auth_user_id, short_name, full_name, role, member_type, email)
values
  (null, 'Ben',   'Ben Rush',     'parent', 'parent', 'ben.rush@digitize.com.sg'),
  (null, 'Alice', 'Alice Zou',    'parent', 'parent', 'alice.zou@asianartplatform.com'),
  (null, 'Riley', 'Riley Rush',   'child',  'child',  null),
  (null, 'Robin', 'Robin Rush',   'child',  'child',  null);
```

Helpers (Diwen) get added later via the Admin page once the app is
live and Ben has logged in.

### 10. Configure the web app environment

```bash
cd apps/web
cp ../../.env.example .env.local
# edit .env.local — only VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are
# read on the client.
```

### 11. Create the parent auth users

In the Supabase dashboard, Authentication → Users → "Add user" (with
"Send magic link" off — set the password directly). Create one for
Ben and one for Alice. Then in SQL:

```sql
update family_members
   set auth_user_id = '<auth user id>'
 where short_name = 'Ben';
-- repeat for Alice
```

(Once the Admin page lands in chunk 2, this becomes a single click.)

### 12. Run the web app

```bash
cd apps/web
npm run dev
# open http://localhost:5173
```

The app currently shows a placeholder boot screen. Auth, calendar,
settings, and admin land in subsequent build chunks — see
[CLAUDE.md](./CLAUDE.md) → "Build chunks".

## Smoke tests

Once the calendar build is in:

1. Log in as Ben, complete MFA enrolment, see the calendar
2. Create a recurring weekly event with Ben + Alice as attendees and
   one 60-minute reminder, channel "both"
3. Settings → generate Telegram setup link → tap on phone → see
   "✅ Telegram linked" inside both Telegram and the Settings card
4. Wait for the next 5-min cron tick, check `notification_dispatch_log`
   for the corresponding `sent` row and that Telegram + email both
   arrived
5. Push to `main`, confirm Vercel deploys, smoke-test the live URL

## Deploying

```bash
git push origin main
```

Vercel is wired to the `apps/web` subdirectory (set in the project's
"Root Directory" setting in the Vercel dashboard). Each push to main
ships to `https://rushhq.co`.

## Common operations

### Re-deploy a single edge function

```bash
supabase functions deploy dispatch-reminders
```

### Trigger the dispatcher manually for testing

```bash
curl -s -X POST \
  "https://YOUR_PROJECT_REF.supabase.co/functions/v1/dispatch-reminders" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"
```

### See what the dispatcher did

```sql
select dispatched_at, channel, status, error_message, payload
  from notification_dispatch_log
  order by dispatched_at desc
  limit 50;
```

### Reset a member's Telegram link

```sql
update telegram_contacts
   set chat_id = null,
       telegram_username = null,
       linked_at = null,
       pending_token = null,
       pending_token_expires_at = null
 where member_id = '<uuid>';
```
