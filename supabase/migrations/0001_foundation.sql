-- Rush HQ — foundation schema
-- ============================
-- Login-only family operations site. Three real users (two parents +
-- one helper), plus children as family_members rows without auth users
-- yet. RLS is mandatory on every table; service-role-only access is the
-- escape hatch for edge functions.
--
-- Tables in this migration:
--   family_members              the canonical "who" — every person is a row
--   calendar_events             one row per event (recurrences expanded client-side)
--   calendar_event_attendees    many-to-many between events and members
--   calendar_reminders          per-event reminders (lead time + channel)
--   telegram_contacts           per-member Telegram link state + pending tokens
--   notification_preferences    per-member channel toggles per event type
--   notification_dispatch_log   audit log for the dispatcher edge function
--
-- Helper functions:
--   public.current_member_id()  family_members.id of the logged-in auth user
--   public.is_parent()          true if the logged-in user has role = 'parent'

-- ----------------------------------------------------------------------------
-- Extensions
-- ----------------------------------------------------------------------------

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------

create type member_role as enum ('parent', 'helper', 'child');
create type member_type as enum ('parent', 'helper', 'child');
create type event_visibility as enum ('family', 'parents');
create type reminder_channel as enum ('telegram', 'email', 'both');
create type dispatch_status as enum ('queued', 'sent', 'failed', 'skipped');
create type notification_event_type as enum (
  'calendar_reminder',
  'calendar_event_created',
  'calendar_event_updated',
  'calendar_event_cancelled'
);

-- ----------------------------------------------------------------------------
-- family_members
-- ----------------------------------------------------------------------------

create table family_members (
  id              uuid primary key default gen_random_uuid(),
  auth_user_id    uuid unique references auth.users(id) on delete set null,
  short_name      text not null check (length(short_name) between 1 and 40),
  full_name       text not null check (length(full_name) between 1 and 120),
  role            member_role not null,
  member_type     member_type not null,
  email           text,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index family_members_auth_user_id_idx
  on family_members (auth_user_id) where auth_user_id is not null;

comment on table family_members is
  'Every person is a row, whether or not they have an auth login. auth_user_id is null for children too young for accounts.';

-- ----------------------------------------------------------------------------
-- calendar_events
-- ----------------------------------------------------------------------------

create table calendar_events (
  id              uuid primary key default gen_random_uuid(),
  title           text not null check (length(title) between 1 and 200),
  description     text,
  location        text,
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  all_day         boolean not null default false,
  rrule           text,
  visibility      event_visibility not null default 'family',
  created_by      uuid not null references family_members(id) on delete restrict,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (ends_at >= starts_at)
);

create index calendar_events_starts_at_idx on calendar_events (starts_at);
create index calendar_events_visibility_idx on calendar_events (visibility);

comment on column calendar_events.rrule is
  'iCal RRULE string for recurring events, expanded client-side. Null = single-instance event.';

-- ----------------------------------------------------------------------------
-- calendar_event_attendees
-- ----------------------------------------------------------------------------

create table calendar_event_attendees (
  event_id        uuid not null references calendar_events(id) on delete cascade,
  member_id       uuid not null references family_members(id) on delete cascade,
  primary key (event_id, member_id)
);

create index calendar_event_attendees_member_idx on calendar_event_attendees (member_id);

-- ----------------------------------------------------------------------------
-- calendar_reminders
-- ----------------------------------------------------------------------------

create table calendar_reminders (
  id                    uuid primary key default gen_random_uuid(),
  event_id              uuid not null references calendar_events(id) on delete cascade,
  lead_time_minutes     integer not null check (lead_time_minutes >= 0 and lead_time_minutes <= 60 * 24 * 30),
  channel               reminder_channel not null,
  created_at            timestamptz not null default now()
);

create index calendar_reminders_event_idx on calendar_reminders (event_id);

-- ----------------------------------------------------------------------------
-- telegram_contacts
-- ----------------------------------------------------------------------------

create table telegram_contacts (
  member_id                 uuid primary key references family_members(id) on delete cascade,
  pending_token             text,
  pending_token_expires_at  timestamptz,
  chat_id                   bigint,
  telegram_username         text,
  linked_at                 timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create unique index telegram_contacts_chat_id_idx
  on telegram_contacts (chat_id) where chat_id is not null;

create unique index telegram_contacts_pending_token_idx
  on telegram_contacts (pending_token) where pending_token is not null;

comment on table telegram_contacts is
  'Per-member Telegram link state. Pending tokens expire after 24h. chat_id stays null until /start <token> completes onboarding.';

-- ----------------------------------------------------------------------------
-- notification_preferences
-- ----------------------------------------------------------------------------

create table notification_preferences (
  member_id           uuid not null references family_members(id) on delete cascade,
  event_type          notification_event_type not null,
  telegram_enabled    boolean not null default true,
  email_enabled       boolean not null default true,
  updated_at          timestamptz not null default now(),
  primary key (member_id, event_type)
);

comment on table notification_preferences is
  'Default state when no row exists is enabled. Settings page upserts a row per toggle change.';

-- ----------------------------------------------------------------------------
-- notification_dispatch_log
-- ----------------------------------------------------------------------------

create table notification_dispatch_log (
  id                  uuid primary key default gen_random_uuid(),
  reminder_id         uuid references calendar_reminders(id) on delete set null,
  event_id            uuid references calendar_events(id) on delete set null,
  member_id           uuid references family_members(id) on delete set null,
  channel             text not null check (channel in ('telegram', 'email')),
  status              dispatch_status not null,
  scheduled_for       timestamptz,
  dispatched_at       timestamptz not null default now(),
  payload             jsonb,
  error_message       text
);

create index notification_dispatch_log_dispatched_at_idx
  on notification_dispatch_log (dispatched_at desc);

create unique index notification_dispatch_log_dedupe_idx
  on notification_dispatch_log (reminder_id, member_id, channel, scheduled_for)
  where reminder_id is not null and scheduled_for is not null;

comment on index notification_dispatch_log_dedupe_idx is
  'Prevents the dispatcher from sending the same reminder twice if it ever runs concurrently or is retried.';

-- ----------------------------------------------------------------------------
-- updated_at triggers
-- ----------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger family_members_touch_updated_at
  before update on family_members
  for each row execute function public.touch_updated_at();

create trigger calendar_events_touch_updated_at
  before update on calendar_events
  for each row execute function public.touch_updated_at();

create trigger telegram_contacts_touch_updated_at
  before update on telegram_contacts
  for each row execute function public.touch_updated_at();

create trigger notification_preferences_touch_updated_at
  before update on notification_preferences
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- Auth helpers
-- ----------------------------------------------------------------------------

create or replace function public.current_member_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from family_members where auth_user_id = auth.uid() limit 1;
$$;

create or replace function public.is_parent()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role = 'parent' from family_members where auth_user_id = auth.uid() limit 1),
    false
  );
$$;

create or replace function public.is_helper()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role = 'helper' from family_members where auth_user_id = auth.uid() limit 1),
    false
  );
$$;

grant execute on function public.current_member_id() to authenticated;
grant execute on function public.is_parent() to authenticated;
grant execute on function public.is_helper() to authenticated;

-- ----------------------------------------------------------------------------
-- RLS — enable on every table
-- ----------------------------------------------------------------------------

alter table family_members enable row level security;
alter table calendar_events enable row level security;
alter table calendar_event_attendees enable row level security;
alter table calendar_reminders enable row level security;
alter table telegram_contacts enable row level security;
alter table notification_preferences enable row level security;
alter table notification_dispatch_log enable row level security;

-- ---- family_members --------------------------------------------------------

-- Anyone signed in can see the active roster (small family, low risk; the
-- alternative is a brittle calendar-attendee-name lookup).
create policy "Authenticated can read family_members"
  on family_members for select
  to authenticated
  using (true);

-- Each member can update their own row (e.g. fix their short_name).
create policy "Members can update their own row"
  on family_members for update
  to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

-- Parents can do anything (insert new members, deactivate, link auth users).
create policy "Parents can manage family_members"
  on family_members for all
  to authenticated
  using (public.is_parent())
  with check (public.is_parent());

-- ---- calendar_events -------------------------------------------------------

-- Helpers see only family-visibility events. Parents see everything.
create policy "Members can read events they're allowed to see"
  on calendar_events for select
  to authenticated
  using (
    public.is_parent()
    or visibility = 'family'
  );

-- Only parents create / update / delete events.
create policy "Parents can manage events"
  on calendar_events for all
  to authenticated
  using (public.is_parent())
  with check (public.is_parent());

-- ---- calendar_event_attendees ---------------------------------------------

create policy "Members can read attendees of visible events"
  on calendar_event_attendees for select
  to authenticated
  using (
    exists (
      select 1 from calendar_events e
      where e.id = calendar_event_attendees.event_id
        and (public.is_parent() or e.visibility = 'family')
    )
  );

create policy "Parents can manage attendees"
  on calendar_event_attendees for all
  to authenticated
  using (public.is_parent())
  with check (public.is_parent());

-- ---- calendar_reminders ----------------------------------------------------

create policy "Members can read reminders for visible events"
  on calendar_reminders for select
  to authenticated
  using (
    exists (
      select 1 from calendar_events e
      where e.id = calendar_reminders.event_id
        and (public.is_parent() or e.visibility = 'family')
    )
  );

create policy "Parents can manage reminders"
  on calendar_reminders for all
  to authenticated
  using (public.is_parent())
  with check (public.is_parent());

-- ---- telegram_contacts -----------------------------------------------------

-- A member sees their own contact row. Parents see everyone's so they can
-- generate setup links on their behalf from the Admin page.
create policy "Members read own telegram contact"
  on telegram_contacts for select
  to authenticated
  using (
    member_id = public.current_member_id()
    or public.is_parent()
  );

-- A member can upsert/update their own (re-generate token, disconnect).
-- Parents can do the same for anyone.
create policy "Members manage own telegram contact"
  on telegram_contacts for all
  to authenticated
  using (
    member_id = public.current_member_id()
    or public.is_parent()
  )
  with check (
    member_id = public.current_member_id()
    or public.is_parent()
  );

-- ---- notification_preferences ---------------------------------------------

create policy "Members manage own preferences"
  on notification_preferences for all
  to authenticated
  using (member_id = public.current_member_id())
  with check (member_id = public.current_member_id());

create policy "Parents read all preferences"
  on notification_preferences for select
  to authenticated
  using (public.is_parent());

-- ---- notification_dispatch_log --------------------------------------------

-- Read-only for parents (admin observability). Service role writes.
create policy "Parents read dispatch log"
  on notification_dispatch_log for select
  to authenticated
  using (public.is_parent());

-- ----------------------------------------------------------------------------
-- Service role notes
-- ----------------------------------------------------------------------------
-- The dispatcher and telegram-webhook edge functions both connect with the
-- service_role key, which bypasses RLS. They write to notification_dispatch_log
-- and update telegram_contacts (chat_id, linked_at, telegram_username, clear
-- pending_token) on /start <token> success.
