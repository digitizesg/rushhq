# Rush HQ

Login-only family operations site for the Rush family. Calendar plus
auth/admin/settings shell that the next modules (beads, stocks,
finance) will plug into.

Read [CLAUDE.md](./CLAUDE.md) for architecture, conventions, and
guardrails before changing code.

## Setup runbook

Numbered steps so it's clear what's done and what's left. Fresh-machine
setup walks through all 13.

### 1. Install prerequisites

- Node 22 LTS (`nvm install 22 && nvm use 22`)
- Supabase CLI (works fine via `npx supabase`, no global install needed)
- Optional: `gh`, `vercel` CLIs for convenience
- Telegram bot already created as `@RushFamilyBot` (token in 1Password)

### 2. Clone the repo and install web deps

```bash
git clone https://github.com/digitizesg/rushhq.git
cd rushhq/apps/web
npm install
```

### 3. Create the Supabase project

Project lives at `kkwslqdqwnzcpsunhdsj.supabase.co`. Email signup is
disabled at the project level, and Resend is configured as the custom
SMTP provider for auth emails (verifications, invites, password resets).

### 4. Link the local CLI to the project

```bash
cd rushhq
export SUPABASE_ACCESS_TOKEN=sbp_...   # from supabase.com/dashboard/account/tokens
npx supabase link --project-ref kkwslqdqwnzcpsunhdsj
```

### 5. Store the service-role key in Vault

The dispatcher cron job reads the service-role key from Supabase Vault
on every fire (modern Supabase locks `ALTER DATABASE` even from the
SQL editor, so the older "GUC" approach no longer works). Migration
0003 expects a Vault secret named `rushhq_service_role_key`.

In the SQL editor:

```sql
select vault.create_secret(
  '<service_role_key>',
  'rushhq_service_role_key'
);
```

Get the service-role key from
`Project Settings → API` or via `npx supabase projects api-keys`.

### 6. Apply migrations

```bash
export SUPABASE_DB_PASSWORD='<db password from Settings → Database>'
npx supabase db push
```

This applies all four migrations:

- `0001_foundation.sql` — tables, enums, RLS, helper functions
- `0002_dispatch_helpers.sql` — `fetch_dispatch_candidates(...)`
- `0003_schedule_dispatcher.sql` — pg_cron + pg_net, reads vault secret
- `0004_event_rpcs.sql` — `create_calendar_event` / `update_calendar_event`

### 7. Set edge-function secrets

```bash
npx supabase secrets set \
  TELEGRAM_BOT_TOKEN=... \
  TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 32) \
  TELEGRAM_BOT_USERNAME=RushFamilyBot \
  RESEND_API_KEY=re_... \
  APP_URL=https://rushhq.co \
  FROM_EMAIL='Rush HQ <notify@rushhq.co>' \
  --project-ref kkwslqdqwnzcpsunhdsj
```

Save the `TELEGRAM_WEBHOOK_SECRET` value — you'll re-use it in step 8.

### 8. Deploy edge functions and register the Telegram webhook

```bash
npx supabase functions deploy dispatch-reminders
npx supabase functions deploy telegram-webhook --no-verify-jwt
npx supabase functions deploy create-family-member
```

`telegram-webhook` deploys with `--no-verify-jwt` because Telegram
won't carry a Supabase JWT — we authenticate via the secret-token
header instead.

Then point Telegram at the function:

```bash
TELEGRAM_BOT_TOKEN=...    # @BotFather
TELEGRAM_WEBHOOK_SECRET=...  # from step 7
curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H 'content-type: application/json' \
  -d "{
    \"url\": \"https://kkwslqdqwnzcpsunhdsj.supabase.co/functions/v1/telegram-webhook\",
    \"secret_token\": \"${TELEGRAM_WEBHOOK_SECRET}\",
    \"allowed_updates\": [\"message\"]
  }"
```

### 9. Seed the kids

```sql
insert into family_members (short_name, full_name, role, member_type)
values
  ('Riley', 'Riley Rush', 'child',  'child'),
  ('Robin', 'Robin Rush', 'child',  'child');
```

### 10. Bootstrap the first parent (Ben)

The Admin page can add new members + their auth user in one click,
but only after a parent is signed in. Bootstrap Ben manually:

1. Supabase dashboard → Authentication → Users → "Add user". Enter
   email + password (skip "Send magic link" — we'll set the password
   directly).
2. Note the new user's UUID.
3. In SQL:

```sql
insert into family_members (short_name, full_name, role, member_type, email, auth_user_id)
values (
  'Ben', 'Ben Rush', 'parent', 'parent',
  'ben.rush@digitize.com.sg',
  '<auth user uuid>'
);
```

### 11. Configure the web app environment

```bash
cd apps/web
cp .env.example .env.local
# fill VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY,
# and VITE_TELEGRAM_BOT_USERNAME=RushFamilyBot
```

### 12. Run the web app

```bash
npm run dev
# open http://localhost:5173
```

Sign in as Ben, complete MFA enrolment (mandatory for parents). You're
in the calendar.

### 13. Add Alice + helpers via Admin

From Ben's session: Admin → "+ Add member" → tick "Send them an
invite email". Resend delivers a sign-up link; the invitee lands on
`/reset-password`, picks a password, and is in.

## Smoke tests

1. Log in as Ben, complete MFA enrolment, see the calendar
2. Create a recurring weekly event with Ben + Alice as attendees and
   a 60-minute reminder, channel "both"
3. Settings → generate Telegram setup link → tap on phone → see
   "✓ Linked"
4. Wait for the next 5-min cron tick, check Admin → "Recent
   notifications" for the corresponding `sent` row, and your Telegram
   + email both arrived
5. Push to `main`, confirm Vercel deploys, smoke-test the live URL

## Deploying

```bash
git push origin main
```

Vercel is wired to the repo root via `vercel.json`, which builds and
serves `apps/web/dist`. Every push to `main` ships to
`https://rushhq.co`.

Vercel env vars (Project → Settings → Environment Variables):

- `VITE_SUPABASE_URL` = `https://kkwslqdqwnzcpsunhdsj.supabase.co`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_TELEGRAM_BOT_USERNAME` = `RushFamilyBot`

## Common operations

### Re-deploy a single edge function

```bash
npx supabase functions deploy dispatch-reminders
```

### Trigger the dispatcher manually for testing

```bash
curl -s -X POST \
  "https://kkwslqdqwnzcpsunhdsj.supabase.co/functions/v1/dispatch-reminders" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"
```

### See what the dispatcher did

```sql
select dispatched_at, channel, status, error_message, payload
  from notification_dispatch_log
  order by dispatched_at desc
  limit 50;
```

Or check the same data in the app: Admin → "Recent notifications".

### Reset a member's Telegram link

Settings → Telegram → Disconnect (or, in Admin, click the row's
"Manage Telegram"). For ops bypass:

```sql
update telegram_contacts
   set chat_id = null,
       telegram_username = null,
       linked_at = null,
       pending_token = null,
       pending_token_expires_at = null
 where member_id = '<uuid>';
```

### Rotate the service-role key (e.g. after a leak)

```sql
-- In Supabase SQL editor, after rotating in Settings → API:
do $$ declare existing uuid;
begin
  select id into existing from vault.secrets where name = 'rushhq_service_role_key';
  perform vault.update_secret(existing, '<new key>', 'rushhq_service_role_key');
end $$;
```

The cron job picks up the new value on its next fire — no migration
or function redeploy needed.
