# Rush HQ — project context for Claude Code

A login-only family operations site for the Rush family. Live at
`rushhq.co` with four modules: **calendar**, **beads**, **stocks**,
**finance**.

This file is authoritative. If a build prompt or PR description
contradicts it, ask before resolving.

## Stack

- React 18 + Vite + TypeScript
- Tailwind CSS v4 (via `@tailwindcss/vite`)
- React Router v6
- Supabase: Postgres + Auth + Edge Functions + pg_cron + pg_net + Vault
- Resend, configured as Supabase custom SMTP (auth + invite emails go through it)
- Telegram Bot API for chat notifications (`@RushFamilyBot`)
- lucide-react for icons
- Vercel for hosting

## Repo layout

```
rushhq/
├── apps/
│   └── web/                              the React app
│       ├── src/
│       │   ├── auth/                     auth context + route guards
│       │   ├── beads/                    use-bead-data hook
│       │   ├── calendar/                 month/week/day/agenda views, event form
│       │   ├── components/               Button, Modal, TextField, Select,
│       │   │                             AppShell, BeadDot, etc.
│       │   ├── finance/                  use-finance-data hook
│       │   ├── lib/                      supabase client, types, helpers
│       │   ├── pages/                    routes (one folder per module)
│       │   ├── stocks/                   use-stocks-data hook
│       │   ├── app.tsx                   router
│       │   ├── main.tsx                  entry point
│       │   └── index.css                 Tailwind theme
│       ├── index.html
│       ├── vite.config.ts
│       └── package.json
├── supabase/
│   ├── migrations/
│   │   ├── 0001_foundation.sql           family_members, calendar_*, telegram_contacts,
│   │   │                                 notification_*, helper functions, RLS
│   │   ├── 0002_dispatch_helpers.sql     fetch_dispatch_candidates(...)
│   │   ├── 0003_schedule_dispatcher.sql  pg_cron + pg_net, vault-backed bearer
│   │   ├── 0004_event_rpcs.sql           create_/update_calendar_event(...)
│   │   ├── 0005_beads.sql                bead_colours, bead_charts, bead_chart_items,
│   │   │                                 bead_periods, bead_counts, view + RPCs
│   │   ├── 0006_beads_drop_categories.sql  flat-list simplification
│   │   ├── 0007_bead_notifications.sql   notification_outbox + RPC enqueues
│   │   ├── 0008_stocks.sql               price_cache, pending_deposits,
│   │   │                                 stock_transactions, stock_allocations,
│   │   │                                 portfolio_snapshots, child_holdings view,
│   │   │                                 4 record_* RPCs
│   │   └── 0009_finance.sql              accounts, account_snapshots,
│   │                                     total_assets_over_time view,
│   │                                     prefill_month_from_previous RPC
│   └── functions/
│       ├── dispatch-reminders/           every 5 min: calendar reminders + outbox drain
│       ├── telegram-webhook/             handles /start <token> from the bot
│       ├── create-family-member/         parent-only invite + linked row insert
│       ├── refresh-prices/               every 15 min: VOO + USDSGD from Yahoo
│       └── snapshot-portfolio/           1st of each month: portfolio_snapshots + summaries
├── vercel.json                           builds/serves apps/web
├── .env.example
├── CLAUDE.md
└── README.md
```

The web app is a single Vite app at `apps/web`. The folder-level split
exists because future infra (e.g. a separate dispatcher app) might
want its own folder under `apps/`.

## People

- **Ben** (`ben.rush@digitize.com.sg`) — role `parent`, full access
- **Alice** (`alice.zou@asianartplatform.com`) — role `parent`, full access
- **Diwen** (helper, email TBD) — role `helper`, calendar-only
- **Riley** — `family_members.member_type = 'child'`, no auth user yet
- **Robin** — same; too young, notifications about him route to a parent's Telegram

## Conventions — non-negotiable

- **British spelling** in UI copy and code comments
- **Sentence case** for headings, buttons, labels — never Title Case
- **No em dashes** (—) in user-facing copy. Use commas, full stops, parentheses
- **No consultancy jargon** — "Add member", not "Onboard new family member"
- **British dates** in UI: `Mon 5 May 2026`. ISO in storage
- **24-hour clock** in UI: `19:30`, not `7:30 PM`
- **Currency**: `S$1,234.56` for SGD, `US$1,234.56` for USD, never `$` alone
- **TypeScript everywhere**, no `any` without a `// reason:` comment
- **File names**: `kebab-case.tsx` for components/routes, `kebab-case.ts` for modules
- **Component names**: `PascalCase`
- **Imports**: absolute via `@/` alias

## Visual direction

White/off-white background, Inter throughout, single blue accent for
primary actions, vivid pastels per category for chips. Tokens live in
`apps/web/src/index.css` via Tailwind v4's `@theme`:

| Token | Hex | Used for |
|---|---|---|
| `--color-page` | `#f5f6f8` | page background |
| `--color-card` | `#ffffff` | cards |
| `--color-soft` | `#f1f3f7` | hover / secondary surfaces |
| `--color-line` | `#e6e8ee` | hairline borders |
| `--color-ink` | `#0f172a` | primary text |
| `--color-muted` | `#64748b` | secondary text |
| `--color-primary` | `#2563eb` | brand accent |
| `--color-emerald` | `#059669` | positive change |
| `--color-amber` | `#d97706` | warnings |
| `--color-danger` | `#e11d48` | destructive |

Member chips read from a 7-colour palette in `lib/colours.ts` (blue,
violet, emerald, amber, rose, indigo, cyan), assigned by hashing the
member id so each person gets a stable hue.

## Hard guardrails

- **Never disable RLS** on any table. Use service_role from an edge function for elevated access.
- **No service_role keys, bot tokens, or Resend keys in client code** — edge functions only.
- **No materialising recurring calendar occurrences** into the database. Expand `rrule` strings client-side or in the dispatcher (uses `rrulestr` from esm.sh).
- **No public signup flow.** Supabase email signups are disabled at the project level. New users are created by parents from Admin via the `create-family-member` edge function, which optionally invites via `auth.admin.inviteUserByEmail` (Resend SMTP delivers the link).
- **Helpers see only family-visibility calendar events.** Zero access to beads, stocks, finance — verified via RLS *and* nav hiding.
- **Children read only their own data** in beads + stocks. RLS scopes via `current_member_id()`.
- **Stocks: never read from a brokerage.** Users record what already happened on moomoo. The only external read is the unauthenticated Yahoo Finance chart endpoint for VOO + USDSGD prices.
- **Stocks: no editing of `total_shares`, `price_per_share_usd`, or any allocation amounts after a transaction is created.** Mistakes are corrected by recording an offsetting transaction. Only `notes` are editable.
- **Don't show USD anywhere on `/stocks/me`.** Kids think in SGD; USD is a parent-side concern.
- **Finance: no auto-fetching from banks**, no liabilities (concept-test first), parents-only at every layer.

## Architecture notes

### Auth + roles

- Two role values used today in `family_members.role`: `parent` and `helper`. The `child` role exists in the enum and is wired through (children read their own bead/stock data) but Riley/Robin don't have auth users yet.
- MFA is mandatory for `parent` accounts. The route guard sends them to `/mfa` if no verified TOTP factor exists.
- Auth emails (verification, password reset, invites) go through Resend via Supabase custom-SMTP, configured at the project level.

### RLS shape

Helpers in `0001_foundation.sql`:

- `public.current_member_id()` — returns the `family_members.id` of the logged-in user, or null
- `public.is_parent()` / `public.is_helper()` — boolean role checks

Policies follow a consistent shape: parents can do anything in their domain; children read their own beads/stocks; helpers get scoped read-only access to family-visibility calendar events; nobody else sees finance.

### Calendar

`calendar_events` is the canonical store. Recurring events are a single row with an iCal `rrule` string. `calendar_event_attendees` is a many-to-many join. `calendar_reminders` lives at the event level (every attendee shares the same reminder set, but per-attendee notification preferences + contact info determine what actually goes out).

The React app expands recurrences with `rrule` npm package; the edge function uses `rrulestr` from esm.sh.

### Beads

`bead_charts` are versioned per child (`effective_until = null` is active). `bead_chart_items` is a flat ordered list of tasks per chart with FK to `bead_colours` (six seeded colours, fixed SGD values). `bead_periods` is one row per (child × month) with status flow `open → counted → invested`. `bead_counts` is (period × colour) → count. `bead_period_totals` view sums to SGD.

RPCs:
- `clone_bead_chart(child_id, effective_from)` — closes active chart, creates new one with copied items, enqueues `bead_chart_published` outbox row
- `ensure_bead_period(child_id, period_start)` — idempotent get-or-create for the month
- `lock_bead_period(period_id)` — open → counted, enqueues `bead_period_locked` outbox row
- `reopen_bead_period(period_id)` — counted → open

When a bead period is selected for a stock purchase, `record_bead_purchase` transitions it to `invested` and fills `invested_transaction_id`.

### Stocks

VOO ETF tracking per child. The user enters what already happened on moomoo; we never call a brokerage. Money in via:
- `bead_purchase` — pro-rata across counted bead periods + pending deposits
- `gift_purchase` — single-child quick buy from a relative's gift
- `dividend_reinvest` — pro-rata by current shares held

Money out via `withdrawal`, which uses average-cost method to reduce cost basis.

Tables: `stock_transactions` (signed shares + price + FX, generated `total_usd`/`total_sgd`), `stock_allocations` (signed per child), `pending_deposits`, `price_cache`, `portfolio_snapshots`. View `child_holdings` aggregates current position per child.

Two cron-driven edge functions:
- `refresh-prices` every 15 min: Yahoo Finance unofficial chart endpoint, upserts `price_cache`
- `snapshot-portfolio` 1st of month: per-child `portfolio_snapshots` row + enqueues `stock_monthly_summary` outbox rows

### Finance

Monthly bank-balance snapshots across the eight family accounts (seeded by 0009). `accounts` is the roster, `account_snapshots` is one row per (account × first-of-month). View `total_assets_over_time` aggregates active accounts per month.

`prefill_month_from_previous(month)` is idempotent — copies the prior month's balances forward into target month for any account that doesn't yet have a row. The `/finance/update/:month` page calls it on mount.

Parents-only at every layer (RLS, nav, route guard). Helpers and children don't even know it exists.

### Notification system

Two delivery patterns share `notification_dispatch_log` (audit) and the `dispatch-reminders` edge function (delivery):

1. **Calendar reminders.** Per-event `calendar_reminders` rows with lead time. The dispatcher reads `fetch_dispatch_candidates(window_start, window_end)` every 5 min, expands RRULEs, and fans out per attendee × channel. Dedupe key on `(reminder_id, member_id, channel, scheduled_for)` keeps it idempotent.
2. **Outbox events.** RPCs and triggers `INSERT INTO notification_outbox` rows with `event_type` + `payload`. The dispatcher drains `notification_outbox_pending` (a view that joins outbox + member contact + per-event-type preferences), formats based on event type, sends, marks `processed_at`.

Active event types:

| Event | Source | Recipients |
|---|---|---|
| `calendar_reminder` | calendar_reminders | event attendees |
| `bead_chart_published` | clone_bead_chart RPC | parents + the child |
| `bead_period_locked` | lock_bead_period RPC | parents |
| `stock_purchase_recorded` | record_*_purchase / record_dividend / record_withdrawal | parents |
| `stock_monthly_summary` | snapshot-portfolio function | parents + each child (with their own data) |
| `finance_monthly_reminder` | pg_cron 1st-of-month job | parents only |

### Telegram setup

The `telegram_contacts` table holds per-member link state: `pending_token` (32 hex chars) + `pending_token_expires_at` (now + 24h), `chat_id` (set on /start <token>), `telegram_username`, `linked_at`.

The Settings page generates the token. The deep link `https://t.me/RushFamilyBot?start=<token>` opens Telegram pre-filled. User taps Start, Telegram POSTs to our `telegram-webhook` edge function (verified via `X-Telegram-Bot-Api-Secret-Token` header), which validates and updates the row.

Only parents can generate setup links for *other* people. Anyone can generate their own.

## Cron schedules

| Job name | Schedule (UTC) | What it does |
|---|---|---|
| `rushhq-dispatch-reminders` | `*/5 * * * *` | Calendar reminders + outbox drain |
| `rushhq-refresh-prices` | `*/15 * * * *` | VOO + USDSGD price fetch |
| `rushhq-snapshot-portfolio` | `0 1 1 * *` | Monthly per-child portfolio snapshot (09:00 SGT on the 1st) |
| `rushhq-finance-monthly-reminder` | `0 1 1 * *` | Inserts finance reminder outbox rows for parents |

All four jobs read the service-role bearer from Vault on every fire (`vault.decrypted_secrets` view, secret name `rushhq_service_role_key`).

## Env vars

| Name | Where | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | client | publishable |
| `VITE_SUPABASE_ANON_KEY` | client | publishable |
| `VITE_TELEGRAM_BOT_USERNAME` | client | `RushFamilyBot` |
| `SUPABASE_URL` | edge functions | auto-injected by Supabase platform |
| `SUPABASE_SERVICE_ROLE_KEY` | edge functions | auto-injected; **never** in the client |
| `TELEGRAM_BOT_TOKEN` | edge functions | from @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | edge functions | random; set on `setWebhook` |
| `TELEGRAM_BOT_USERNAME` | edge functions | `RushFamilyBot` |
| `RESEND_API_KEY` | edge functions | for reminder + invite emails |
| `APP_URL` | edge functions | `https://rushhq.co` |
| `FROM_EMAIL` | edge functions | e.g. `Rush HQ <notify@rushhq.co>` |

The web app reads the `VITE_*` values via `import.meta.env`. Edge functions read everything via `Deno.env.get(...)`. The Supabase Vault holds the `rushhq_service_role_key` secret used by cron-triggered HTTP posts.
