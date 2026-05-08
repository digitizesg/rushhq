-- Family members: preferred_channel
-- ===================================
-- Lets each member say "just send me Telegram" (or "email only") at a
-- single switch, instead of toggling each event type's two flags
-- individually. The dispatcher ANDs each per-type telegram_enabled /
-- email_enabled flag with the member's preferred_channel before
-- deciding what to send, so this is a *narrowing* setting — you can't
-- use it to enable a channel that's been muted at the per-type level.

alter table family_members
  add column if not exists preferred_channel text not null default 'both'
    check (preferred_channel in ('both', 'telegram', 'email'));

-- ----------------------------------------------------------------------------
-- Update the outbox view to apply the preference
-- ----------------------------------------------------------------------------

create or replace view notification_outbox_pending as
select
  o.id              as outbox_id,
  o.event_type,
  o.payload,
  o.created_at,
  o.attempts,
  fm.id             as member_id,
  fm.short_name,
  fm.email,
  fm.role,
  tc.chat_id        as telegram_chat_id,
  (coalesce(np.telegram_enabled, true) and fm.preferred_channel in ('both','telegram')) as telegram_enabled,
  (coalesce(np.email_enabled,    true) and fm.preferred_channel in ('both','email'))    as email_enabled
from notification_outbox o
join family_members fm on fm.id = o.member_id and fm.active = true
left join telegram_contacts tc on tc.member_id = fm.id
left join notification_preferences np
  on np.member_id = fm.id and np.event_type = o.event_type
where o.processed_at is null;

revoke all on notification_outbox_pending from public;
grant select on notification_outbox_pending to service_role;

-- ----------------------------------------------------------------------------
-- Update the calendar reminder dispatch helper
-- ----------------------------------------------------------------------------

create or replace function public.fetch_dispatch_candidates(
  window_start timestamptz,
  window_end   timestamptz
)
returns table (
  reminder_id        uuid,
  lead_time_minutes  integer,
  channel            reminder_channel,
  event_id           uuid,
  title              text,
  description        text,
  location           text,
  starts_at          timestamptz,
  ends_at            timestamptz,
  all_day            boolean,
  rrule              text,
  visibility         event_visibility,
  attendees          jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  with ev as (
    select e.id, e.title, e.description, e.location, e.starts_at, e.ends_at,
           e.all_day, e.rrule, e.visibility, e.notify_extra_roles
      from calendar_events e
  ),
  recipients as (
    select a.event_id, m.id as member_id
      from calendar_event_attendees a
      join family_members m on m.id = a.member_id and m.active = true
    union
    select e.id as event_id, m.id as member_id
      from ev e
      join family_members m on m.active = true and m.role in ('parent','helper')
     where e.notify_extra_roles = true
  ),
  resolved as (
    select
      r.event_id,
      jsonb_agg(
        jsonb_build_object(
          'member_id', m.id,
          'short_name', m.short_name,
          'full_name', m.full_name,
          'email', m.email,
          'role', m.role,
          'telegram_chat_id', tc.chat_id,
          'telegram_enabled',
            (coalesce(np.telegram_enabled, true) and m.preferred_channel in ('both','telegram')),
          'email_enabled',
            (coalesce(np.email_enabled, true) and m.preferred_channel in ('both','email'))
        )
        order by m.short_name
      ) as attendees
    from recipients r
    join family_members m on m.id = r.member_id
    left join telegram_contacts tc on tc.member_id = m.id
    left join notification_preferences np
      on np.member_id = m.id
     and np.event_type = 'calendar_reminder'::notification_event_type
    group by r.event_id
  )
  select
    r.id, r.lead_time_minutes, r.channel,
    ev.id, ev.title, ev.description, ev.location, ev.starts_at, ev.ends_at,
    ev.all_day, ev.rrule, ev.visibility,
    coalesce(ra.attendees, '[]'::jsonb) as attendees
  from calendar_reminders r
  join ev on ev.id = r.event_id
  left join resolved ra on ra.event_id = ev.id
  where
    (ev.rrule is null
       and ev.starts_at - make_interval(mins => r.lead_time_minutes)
           between window_start and window_end)
    or
    ev.rrule is not null;
$$;

revoke all on function public.fetch_dispatch_candidates(timestamptz, timestamptz) from public;
grant execute on function public.fetch_dispatch_candidates(timestamptz, timestamptz) to service_role;

-- ----------------------------------------------------------------------------
-- Update the task reminder dispatch helper
-- ----------------------------------------------------------------------------

create or replace function public.fetch_task_dispatch_candidates(
  window_start timestamptz,
  window_end   timestamptz
)
returns table (
  reminder_id        uuid,
  lead_time_minutes  integer,
  channel            reminder_channel,
  task_id            uuid,
  title              text,
  description        text,
  assignee_id        uuid,
  assignee_short     text,
  assignee_email     text,
  assignee_role      member_role,
  telegram_chat_id   bigint,
  telegram_enabled   boolean,
  email_enabled      boolean,
  due_at             timestamptz,
  rrule              text
)
language sql
stable
security definer
set search_path = public
as $$
  with task_due as (
    select t.id, t.title, t.description, t.assignee_id, t.rrule,
           ((t.due_date::timestamp + coalesce(t.due_time, time '09:00')) at time zone 'Asia/Singapore') as due_at
      from tasks t
     where t.status = 'pending'
  )
  select
    r.id                 as reminder_id,
    r.lead_time_minutes,
    r.channel,
    td.id                as task_id,
    td.title,
    td.description,
    m.id                 as assignee_id,
    m.short_name         as assignee_short,
    m.email              as assignee_email,
    m.role               as assignee_role,
    tc.chat_id           as telegram_chat_id,
    (coalesce(np.telegram_enabled, true) and m.preferred_channel in ('both','telegram')) as telegram_enabled,
    (coalesce(np.email_enabled,    true) and m.preferred_channel in ('both','email'))    as email_enabled,
    td.due_at,
    td.rrule
  from task_reminders r
  join task_due td      on td.id = r.task_id
  join family_members m on m.id = td.assignee_id and m.active = true
  left join telegram_contacts tc on tc.member_id = m.id
  left join notification_preferences np
    on np.member_id = m.id
   and np.event_type = 'task_reminder'::notification_event_type
  where
    (td.rrule is null
       and td.due_at - make_interval(mins => r.lead_time_minutes)
           between window_start and window_end)
    or
    td.rrule is not null;
$$;

revoke all on function public.fetch_task_dispatch_candidates(timestamptz, timestamptz) from public;
grant execute on function public.fetch_task_dispatch_candidates(timestamptz, timestamptz) to service_role;
