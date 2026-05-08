# Rush HQ

Login-only family operations site for the Rush family. Four modules:
calendar, beads, stocks, finance.

Read [CLAUDE.md](./CLAUDE.md) for architecture, conventions, and
guardrails before changing code.

## Setup runbook

Numbered steps so it's clear what's done and what's left. Fresh-machine
setup walks through all 13.

### 1. Install prerequisites

- Node 22 LTS (`nvm install 22 && nvm use 22`)
- Supabase CLI works fine via `npx supabase` (no global install needed)
- Optional: `gh`, `vercel` CLIs for convenience
- Telegram bot already created as `@RushFamilyBot` (token in 1Password)

### 2. Clone the repo and install web deps

```bash
git clone https://github.com/digitizesg/rushhq.git
cd rushhq/apps/web
npm install
```

### 3. Confirm the Supabase project

Project lives at `kkwslqdqwnzcpsunhdsj.supabase.co`. Email signup is
disabled at the project level; Resend is the custom-SMTP provider.

### 4. Link the local CLI to the project

```bash
cd rushhq
export SUPABASE_ACCESS_TOKEN=sbp_...   # supabase.com/dashboard/account/tokens
npx supabase link --project-ref kkwslqdqwnzcpsunhdsj
```

### 5. Store the service-role key in Vault

The four cron jobs read the bearer from Supabase Vault. Modern
Supabase locks `ALTER DATABASE`, so the older "GUC" pattern doesn't
work. In the SQL editor:

```sql
select vault.create_secret(
  '<service_role_key>',
  'rushhq_service_role_key'
);
```

Get the service-role key from `Project Settings → API` or
`npx supabase projects api-keys`.

### 6. Apply migrations

```bash
export SUPABASE_DB_PASSWORD='<db password from Settings → Database>'
npx supabase db push
```

This applies all nine migrations:

| # | What it does |
|---|---|
| 0001 | Foundation: `family_members`, `calendar_events`, `calendar_event_attendees`, `calendar_reminders`, `telegram_contacts`, `notification_preferences`, `notification_dispatch_log`, helper functions, RLS |
| 0002 | `fetch_dispatch_candidates(...)` view function for the dispatcher |
| 0003 | pg_cron + pg_net schedule for `dispatch-reminders` (Vault-backed bearer) |
| 0004 | `create_calendar_event` / `update_calendar_event` RPCs |
| 0005 | Beads: colours (seeded), charts, items, periods, counts, view, RPCs |
| 0006 | Beads simplification: drop categories, flat list of items |
| 0007 | Bead notifications: `notification_outbox` + RPC enqueues |
| 0008 | Stocks: price_cache, pending_deposits, transactions, allocations, snapshots, view, four `record_*` RPCs |
| 0009 | Finance: accounts (seeded with the eight family accounts), snapshots, view, `prefill_month_from_previous` RPC |

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

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected by
the platform — don't set them manually.

Save the `TELEGRAM_WEBHOOK_SECRET` value; you'll re-use it in step 8.

### 8. Deploy edge functions and register the Telegram webhook

```bash
npx supabase functions deploy dispatch-reminders
npx supabase functions deploy telegram-webhook --no-verify-jwt
npx supabase functions deploy create-family-member
npx supabase functions deploy refresh-prices
npx supabase functions deploy snapshot-portfolio
```

`telegram-webhook` deploys with `--no-verify-jwt` because Telegram
won't carry a Supabase JWT — it authenticates via the secret-token
header instead.

Then point Telegram at the function:

```bash
TELEGRAM_BOT_TOKEN=...
TELEGRAM_WEBHOOK_SECRET=...      # from step 7
curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H 'content-type: application/json' \
  -d "{
    \"url\": \"https://kkwslqdqwnzcpsunhdsj.supabase.co/functions/v1/telegram-webhook\",
    \"secret_token\": \"${TELEGRAM_WEBHOOK_SECRET}\",
    \"allowed_updates\": [\"message\"]
  }"
```

### 9. Schedule the four cron jobs

Migration 0003 sets `rushhq-dispatch-reminders`; the other three need
to be scheduled once per project. In the SQL editor:

```sql
-- refresh-prices every 15 min
select cron.schedule(
  'rushhq-refresh-prices',
  '*/15 * * * *',
  $$
    select net.http_post(
      url := 'https://kkwslqdqwnzcpsunhdsj.supabase.co/functions/v1/refresh-prices',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret from vault.decrypted_secrets
          where name = 'rushhq_service_role_key' limit 1
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  $$
);

-- snapshot-portfolio on the 1st of each month at 09:00 SGT (01:00 UTC)
select cron.schedule(
  'rushhq-snapshot-portfolio',
  '0 1 1 * *',
  $$
    select net.http_post(
      url := 'https://kkwslqdqwnzcpsunhdsj.supabase.co/functions/v1/snapshot-portfolio',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret from vault.decrypted_secrets
          where name = 'rushhq_service_role_key' limit 1
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $$
);

-- finance reminder on the 1st (uses inline SQL, no edge function)
select cron.schedule(
  'rushhq-finance-monthly-reminder',
  '0 1 1 * *',
  $$
    insert into notification_outbox (event_type, member_id, payload)
    select 'finance_monthly_reminder'::notification_event_type, fm.id,
           jsonb_build_object('month', to_char(date_trunc('month', current_date), 'YYYY-MM'))
      from family_members fm
     where fm.role = 'parent' and fm.active = true;
  $$
);
```

Verify with `select jobname, schedule from cron.job order by jobname;`.

### 10. Seed the kids

```sql
insert into family_members (short_name, full_name, role, member_type)
values
  ('Riley', 'Riley Rush', 'child', 'child'),
  ('Robin', 'Robin Rush', 'child', 'child');
```

### 11. Bootstrap the first parent (Ben)

The Admin page can add new members + their auth user in one click,
but only after a parent is signed in. Bootstrap Ben manually:

1. Supabase dashboard → Authentication → Users → "Add user" → set the password directly (skip "Send magic link")
2. Note the new user's UUID
3. In SQL:

```sql
insert into family_members (short_name, full_name, role, member_type, email, auth_user_id)
values (
  'Ben', 'Ben Rush', 'parent', 'parent',
  'ben.rush@digitize.com.sg',
  '<auth user uuid>'
);
```

### 12. Configure the web app environment

```bash
cd apps/web
cp .env.example .env.local
# fill VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY,
# and VITE_TELEGRAM_BOT_USERNAME=RushFamilyBot
```

For Vercel, set the same three env vars in Project → Settings →
Environment Variables (Production + Preview).

### 13. Run the web app

```bash
npm run dev
# open http://localhost:5173
```

Sign in as Ben, complete MFA enrolment, you're in. From the Admin page
you can now invite Alice + Diwen via the create-family-member flow.

## Smoke tests

Once everything is configured:

1. **Calendar**: create a recurring weekly event with both parents as attendees and a 60-min reminder. Wait for the next 5-min cron tick, check that Telegram + email arrived and `notification_dispatch_log` shows `sent`.
2. **Beads**: lock May for Riley with some bead counts. Confirmation modal closes, Telegram fires.
3. **Stocks**: with a counted bead period, hit `/stocks/buy`, fill in the trade, see the allocation preview, submit. Confirm the bead period transitions to `invested` and the transaction appears in `/stocks/transactions`.
4. **Finance**: open `/finance`, click "Start [Month] update", enter balances, mark complete. Chart appears with one data point; CTA changes to "Edit [Month]".
5. **Push to main**: Vercel ships, the live URL still works.

## Deploying

```bash
git push origin main
```

Vercel is wired to the repo root via `vercel.json`, which builds and
serves `apps/web/dist`. Every push to `main` ships to
`https://rushhq.co`.

## Common operations

### Re-deploy a single edge function

```bash
npx supabase functions deploy <name>
```

### Trigger a cron job manually

```bash
curl -s -X POST \
  "https://kkwslqdqwnzcpsunhdsj.supabase.co/functions/v1/<name>" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"
```

### See what the dispatcher did

```sql
select dispatched_at, channel, status, error_message, payload
  from notification_dispatch_log
  order by dispatched_at desc
  limit 50;
```

Same data is visible in the app: Admin → Recent notifications.

### See pending outbox

```sql
select event_type, member_id, payload, created_at, attempts, last_error
  from notification_outbox
  where processed_at is null
  order by created_at desc;
```

### Reset a member's Telegram link

Settings → Telegram → Disconnect (or, in Admin, click the row's
"Manage Telegram"). For ops bypass:

```sql
update telegram_contacts
   set chat_id = null, telegram_username = null,
       linked_at = null, pending_token = null,
       pending_token_expires_at = null
 where member_id = '<uuid>';
```

### Rotate the service-role key

After rotating in Supabase → Settings → API, update Vault:

```sql
do $$ declare existing uuid;
begin
  select id into existing from vault.secrets where name = 'rushhq_service_role_key';
  perform vault.update_secret(existing, '<new key>', 'rushhq_service_role_key');
end $$;
```

The cron jobs pick up the new value on their next fire — no migration
or function redeploy needed.

### Manually run the price fetch

```bash
curl -s -X POST \
  "https://kkwslqdqwnzcpsunhdsj.supabase.co/functions/v1/refresh-prices" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"
```

### Seeding bead charts for a fresh project

The migration only seeds `bead_colours`. Charts are project-specific.
Use the Admin page or run a one-off insert against `bead_charts` +
`bead_chart_items` referencing `family_members.id` for each child.
