# Rush HQ — project context for Claude Code

A login-only family operations site for the Rush family. v1 ships the
calendar plus the auth/admin/settings shell that future modules
(beads, stocks, finance) will plug into.

This file is authoritative. If a build prompt or PR description
contradicts it, ask before resolving.

## Stack

- React 18 + Vite + TypeScript
- Tailwind CSS v4 (via `@tailwindcss/vite`)
- React Router v6
- Supabase: Postgres + Auth + Edge Functions
- Resend, configured as Supabase custom SMTP (auth emails go through it)
- Telegram Bot API for chat notifications (`@RushFamilyBot`)
- Vercel for hosting

## Repo layout

```
rushhq/
├── apps/
│   └── web/                  the React app
│       ├── src/
│       ├── index.html
│       ├── vite.config.ts
│       └── ...
├── supabase/
│   ├── migrations/
│   │   ├── 0001_foundation.sql           tables, enums, RLS, helper funcs
│   │   ├── 0002_dispatch_helpers.sql     fetch_dispatch_candidates(...)
│   │   ├── 0003_schedule_dispatcher.sql  pg_cron + pg_net, vault-backed
│   │   └── 0004_event_rpcs.sql           create_/update_calendar_event(...)
│   └── functions/
│       ├── dispatch-reminders/    sends Telegram + email every 5 min
│       ├── telegram-webhook/      handles /start <token> from the bot
│       └── create-family-member/  parent-only invite + linked row insert
├── .env.example
├── CLAUDE.md
└── README.md
```

The web app is a single Vite app at `apps/web`. The folder-level split
exists because future modules (beads, stocks, finance) are likely to
add a separate `apps/dispatch` or similar — keep it monorepo-ready.

## People

Three real auth users:

- **Ben** (`ben.rush@digitize.com.sg`) — role `parent`, full access
- **Alice** (`alice.zou@asianartplatform.com`) — role `parent`, full access
- **Diwen** (helper, email TBD) — role `helper`, calendar-only

Plus two children as `family_members` rows without an `auth_user_id`:

- **Riley** — has her own Telegram, will eventually get a login
- **Robin** — too young, notifications about him route to a parent's Telegram

## Conventions — non-negotiable

- **British spelling** in UI copy and code comments ("colour", "behaviour", "organisation")
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

Warm family palette (NOT a corporate dashboard). Tokens defined in
`apps/web/src/index.css` via Tailwind v4's `@theme`:

| Token         | Hex      | Used for                          |
| ------------- | -------- | --------------------------------- |
| `--color-cream`        | #fbf6ec | page background                   |
| `--color-paper`        | #f4ecd8 | secondary surfaces                |
| `--color-border-warm`  | #e8dcc4 | borders                           |
| `--color-ink`          | #2a2118 | text primary                      |
| `--color-muted`        | #6b5d4c | text secondary                    |
| `--color-sage`         | #5d8a4e | primary accent (life, growth)     |
| `--color-honey`        | #d4a574 | highlights                        |
| `--color-coral`        | #c25f4a | danger / destructive              |

Typography: Fraunces (serif) for the brand mark + major headings,
Inter for UI/body. Slightly rounded corners (6–8px), generous
whitespace, soft shadows. Avoid harsh black borders or pure-white
surfaces against the cream background.

## Hard guardrails

- **Never disable RLS** on any table, even temporarily. If you need
  elevated access, use service_role from an edge function
- **No service_role keys, bot tokens, or Resend keys in client code** —
  edge functions only
- **No materialising recurring calendar occurrences** into the database.
  Expand `rrule` strings client-side (in the React app) or in the edge
  function (uses `rrulestr` from esm.sh). The schema stores `rrule` as
  text on `calendar_events`
- **No public signup flow.** Supabase email signups are disabled at the
  project level. New users are created by parents from the Admin page,
  which calls the `create-family-member` edge function. That function
  verifies the caller is a parent, optionally invites the new user via
  `auth.admin.inviteUserByEmail` (Resend SMTP delivers the link), and
  inserts the linked `family_members` row
- **Helpers see only `visibility = 'family'` events.** Diwen has zero
  visibility into beads, stocks, finance (which don't exist yet — make
  sure the nav doesn't tease them either)
- **Don't style this like a corporate SaaS dashboard.** It's a family
  product. Warm, soft, friendly

## Architecture notes

### Auth + roles

- Two roles in `family_members.role`: `parent` and `helper`. (`child` is
  reserved for when the kids get logins.)
- MFA is mandatory for `parent` accounts — the post-login flow checks
  enrolment and walks the parent through enrolment if needed before
  letting them see anything.
- Auth emails (verification, password reset) go through Resend via
  Supabase's custom-SMTP setting, configured at the Supabase project
  level. Nothing app-specific in code.

### RLS shape

Helpers in `0001_foundation.sql`:

- `public.current_member_id()` — returns the `family_members.id` of the
  logged-in user, or null
- `public.is_parent()` / `public.is_helper()` — boolean role checks

Policies follow a consistent shape: parents can do anything; helpers
get scoped read-only access; everyone can see / manage their own
profile and Telegram contact.

### Calendar storage

`calendar_events` is the canonical store. Recurring events are a single
row with an iCal `rrule` string. `calendar_event_attendees` is a
many-to-many join table. `calendar_reminders` lives at the event level
(every attendee shares the same set of reminders, but each attendee's
notification preferences and contact details determine what actually
goes out).

### Dispatch loop

`pg_cron` triggers `dispatch-reminders` every 5 minutes. The cron
body reads the service-role bearer from Vault on every fire (modern
Supabase locks `ALTER DATABASE`, so the older "GUC" pattern doesn't
work). The function then calls
`fetch_dispatch_candidates(window_start, window_end)`, expands RRULEs
in TypeScript, then for each (occurrence × attendee × channel):

1. Pre-claim a row in `notification_dispatch_log` with status `queued`
2. Send the Telegram message and/or email
3. Update the row to `sent` / `failed`

The unique dedupe index `(reminder_id, member_id, channel,
scheduled_for)` makes the loop idempotent under retries or concurrent
invocations.

### Telegram setup

The `telegram_contacts` table holds per-member link state:

- `pending_token` (32 hex chars) + `pending_token_expires_at` (now + 24h)
- `chat_id` (set when /start <token> succeeds)
- `telegram_username`, `linked_at`

The Settings page generates the token; the deep link
`https://t.me/RushFamilyBot?start=<token>` opens Telegram with the
token pre-filled. The user taps Start, Telegram POSTs `/start <token>`
to our `telegram-webhook` edge function, which validates and updates
the row.

Only parents can generate setup links for *other* people. Anyone
(parents and helpers) can generate their own.

## Env vars

| Name | Where | Notes |
|------|-------|-------|
| `VITE_SUPABASE_URL` | client | publishable |
| `VITE_SUPABASE_ANON_KEY` | client | publishable |
| `SUPABASE_URL` | edge functions | identical value to VITE_ |
| `SUPABASE_SERVICE_ROLE_KEY` | edge functions | **never** in the client |
| `TELEGRAM_BOT_TOKEN` | edge functions | from @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | edge functions | random; set on `setWebhook` |
| `TELEGRAM_BOT_USERNAME` | edge functions + client | `RushFamilyBot` |
| `RESEND_API_KEY` | edge functions | for reminder emails |
| `APP_URL` | edge functions | `https://rushhq.co` |
| `FROM_EMAIL` | edge functions | e.g. `Rush HQ <hello@rushhq.co>` |

The web app reads the two `VITE_*` values via `import.meta.env`. The
edge functions read everything via `Deno.env.get(...)`.

## Build chunks

The first build produced this foundation. Subsequent chunks layer on:

1. ✅ Foundation (this file): schema, edge functions, scaffold, docs
2. App scaffold + auth context + login + MFA + route guards
3. App layout + nav
4. Calendar (month/week/day, RRULE expansion, event form)
5. Settings + Admin
6. Vercel deploy config

When you finish a chunk, summarise what changed, what's pending, and
what Ben should test before continuing.
