-- Rush HQ — tasks module
-- ========================
-- Lightweight to-do list for nudging the kids. Each task has a single
-- canonical row with an optional iCal RRULE for recurring nudges.
-- When a recurring task is completed, the client passes the next
-- occurrence date and the RPC rolls due_date forward — no per-instance
-- history (we want nudges, not a forensic log; v2 can add history if
-- needed).
--
-- Reminders piggyback on the existing dispatcher: a parallel
-- fetch_task_dispatch_candidates helper feeds the same edge function
-- that handles calendar reminders, and the dispatch_log gets a
-- task_reminder_id column with its own dedupe index.

-- The 'task_reminder' enum value is added in 0012_task_reminder_enum.sql.
-- It has to live in a separate migration because Postgres won't let a new
-- enum value be referenced in the same transaction that creates it.

-- ----------------------------------------------------------------------------
-- tasks
-- ----------------------------------------------------------------------------

create table tasks (
  id                  uuid primary key default gen_random_uuid(),
  title               text not null check (length(trim(title)) > 0),
  description         text,
  assignee_id         uuid not null references family_members(id) on delete cascade,
  -- Date the task is "due by". For recurring tasks this is the next
  -- occurrence; rolls forward when completed.
  due_date            date not null,
  -- Optional time on that date. If null, reminders fire relative to a
  -- default (09:00 SGT) defined in the dispatch helper below.
  due_time            time,
  -- iCal RRULE without DTSTART. Null = one-shot.
  rrule               text,
  status              text not null default 'pending' check (status in ('pending', 'done')),
  -- Last completion timestamp — useful for streaks/insight even though
  -- recurring tasks don't keep a history of every instance.
  last_completed_at   timestamptz,
  -- Set once for one-shot tasks when status flips to 'done'.
  completed_at        timestamptz,
  created_by          uuid references family_members(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index tasks_assignee_idx on tasks (assignee_id, status, due_date);
create index tasks_due_idx       on tasks (due_date) where status = 'pending';

create trigger tasks_touch_updated_at
  before update on tasks
  for each row execute function public.touch_updated_at();

comment on table tasks is
  'Single-row task list. Recurring tasks store an RRULE and roll due_date forward on completion (no per-instance log).';

-- ----------------------------------------------------------------------------
-- task_reminders
-- ----------------------------------------------------------------------------

create table task_reminders (
  id                 uuid primary key default gen_random_uuid(),
  task_id            uuid not null references tasks(id) on delete cascade,
  lead_time_minutes  integer not null check (lead_time_minutes >= 0 and lead_time_minutes <= 60 * 24 * 7),
  channel            reminder_channel not null,
  created_at         timestamptz not null default now()
);

create index task_reminders_task_id_idx on task_reminders (task_id);

-- ----------------------------------------------------------------------------
-- Dispatch log: task references + dedupe
-- ----------------------------------------------------------------------------

alter table notification_dispatch_log
  add column task_reminder_id uuid references task_reminders(id) on delete set null,
  add column task_id          uuid references tasks(id) on delete set null;

create unique index notification_dispatch_log_task_dedupe_idx
  on notification_dispatch_log (task_reminder_id, member_id, channel, scheduled_for)
  where task_reminder_id is not null and scheduled_for is not null;

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------

alter table tasks           enable row level security;
alter table task_reminders  enable row level security;

-- Parents: full CRUD on tasks.
create policy "Parents manage all tasks"
  on tasks for all
  to authenticated
  using (public.is_parent())
  with check (public.is_parent());

-- Assigned member: read own tasks. Updates go through RPCs (security definer)
-- that re-check assignee_id, so no UPDATE policy needed.
create policy "Assignee reads own tasks"
  on tasks for select
  to authenticated
  using (assignee_id = public.current_member_id());

-- Reminders: parents only. Kids don't need to see the reminder rows
-- themselves; the dispatcher reads via service_role.
create policy "Parents manage task reminders"
  on task_reminders for all
  to authenticated
  using (public.is_parent())
  with check (public.is_parent());

-- ----------------------------------------------------------------------------
-- RPCs
-- ----------------------------------------------------------------------------

create or replace function public.create_task(
  p_title        text,
  p_description  text,
  p_assignee_id  uuid,
  p_due_date     date,
  p_due_time     time,
  p_rrule        text,
  p_reminders    jsonb -- [{ lead_time_minutes, channel }]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id uuid;
  v_task_id   uuid;
begin
  if not public.is_parent() then
    raise exception 'Only parents can create tasks';
  end if;
  v_caller_id := public.current_member_id();

  if length(trim(coalesce(p_title, ''))) = 0 then
    raise exception 'Title is required';
  end if;
  if p_due_date is null then
    raise exception 'Due date is required';
  end if;

  insert into tasks (title, description, assignee_id, due_date, due_time, rrule, created_by)
  values (
    trim(p_title),
    nullif(trim(coalesce(p_description, '')), ''),
    p_assignee_id,
    p_due_date,
    p_due_time,
    nullif(trim(coalesce(p_rrule, '')), ''),
    v_caller_id
  )
  returning id into v_task_id;

  if p_reminders is not null then
    insert into task_reminders (task_id, lead_time_minutes, channel)
    select
      v_task_id,
      (r->>'lead_time_minutes')::integer,
      (r->>'channel')::reminder_channel
    from jsonb_array_elements(p_reminders) as r;
  end if;

  return v_task_id;
end;
$$;

grant execute on function public.create_task(text, text, uuid, date, time, text, jsonb) to authenticated;


create or replace function public.update_task(
  p_task_id      uuid,
  p_title        text,
  p_description  text,
  p_assignee_id  uuid,
  p_due_date     date,
  p_due_time     time,
  p_rrule        text,
  p_reminders    jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_parent() then
    raise exception 'Only parents can edit tasks';
  end if;

  update tasks
     set title       = trim(p_title),
         description = nullif(trim(coalesce(p_description, '')), ''),
         assignee_id = p_assignee_id,
         due_date    = p_due_date,
         due_time    = p_due_time,
         rrule       = nullif(trim(coalesce(p_rrule, '')), '')
   where id = p_task_id;

  if not found then
    raise exception 'Task % not found', p_task_id;
  end if;

  -- Replace reminders wholesale. Simpler than diffing, and reminders
  -- are config rows with no useful history.
  delete from task_reminders where task_id = p_task_id;
  if p_reminders is not null then
    insert into task_reminders (task_id, lead_time_minutes, channel)
    select
      p_task_id,
      (r->>'lead_time_minutes')::integer,
      (r->>'channel')::reminder_channel
    from jsonb_array_elements(p_reminders) as r;
  end if;
end;
$$;

grant execute on function public.update_task(uuid, text, text, uuid, date, time, text, jsonb) to authenticated;


-- complete_task
-- -------------
-- One-shot task: status='done', completed_at=now.
-- Recurring task: client passes the next occurrence in p_next_due_date
-- (computed via the rrule npm package). If null, treat as one-shot.
-- Allowed: parents, or the assigned member.
create or replace function public.complete_task(
  p_task_id        uuid,
  p_next_due_date  date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_member uuid;
  v_assignee      uuid;
  v_has_rrule     boolean;
begin
  v_caller_member := public.current_member_id();

  select assignee_id, rrule is not null
    into v_assignee, v_has_rrule
    from tasks
   where id = p_task_id;

  if not found then
    raise exception 'Task % not found', p_task_id;
  end if;

  if not public.is_parent() and v_caller_member <> v_assignee then
    raise exception 'Only the assignee or a parent can complete this task';
  end if;

  if v_has_rrule and p_next_due_date is not null then
    -- Recurring: roll forward to the next occurrence; status stays
    -- pending; track the completion timestamp for streaks.
    update tasks
       set due_date          = p_next_due_date,
           last_completed_at = now()
     where id = p_task_id;
  else
    -- One-shot (or recurring with no next occurrence — series ended).
    update tasks
       set status            = 'done',
           completed_at      = now(),
           last_completed_at = now()
     where id = p_task_id;
  end if;
end;
$$;

grant execute on function public.complete_task(uuid, date) to authenticated;


-- snooze_task: bump due_date by N days. Allowed: parents or assignee.
create or replace function public.snooze_task(
  p_task_id  uuid,
  p_days     integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_member uuid;
  v_assignee      uuid;
begin
  if p_days is null or p_days <= 0 or p_days > 30 then
    raise exception 'Snooze must be between 1 and 30 days';
  end if;

  v_caller_member := public.current_member_id();

  select assignee_id into v_assignee from tasks where id = p_task_id;
  if not found then raise exception 'Task % not found', p_task_id; end if;

  if not public.is_parent() and v_caller_member <> v_assignee then
    raise exception 'Only the assignee or a parent can snooze this task';
  end if;

  update tasks
     set due_date = due_date + p_days
   where id = p_task_id;
end;
$$;

grant execute on function public.snooze_task(uuid, integer) to authenticated;


create or replace function public.delete_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_parent() then
    raise exception 'Only parents can delete tasks';
  end if;

  delete from tasks where id = p_task_id;
  if not found then
    raise exception 'Task % not found', p_task_id;
  end if;
end;
$$;

grant execute on function public.delete_task(uuid) to authenticated;


-- ----------------------------------------------------------------------------
-- Dispatch helper
-- ----------------------------------------------------------------------------
-- Mirrors fetch_dispatch_candidates but for tasks. The "due_at" used
-- for reminder scheduling is (due_date + due_time) in Asia/Singapore,
-- defaulting to 09:00 SGT when due_time is null. We return the
-- timestamp in UTC so the edge function compares against its window.
--
-- For recurring tasks we return them unconditionally and let the edge
-- function expand the RRULE (same pattern as calendar). The DTSTART
-- the edge function uses is the current due_at timestamp.

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
    select
      t.id,
      t.title,
      t.description,
      t.assignee_id,
      t.rrule,
      -- 09:00 SGT default for time-less tasks. SGT is UTC+8 with no DST.
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
    coalesce(np.telegram_enabled, true) as telegram_enabled,
    coalesce(np.email_enabled, true)    as email_enabled,
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
    -- One-shot: only return if the reminder fires inside the window.
    (td.rrule is null
       and td.due_at - make_interval(mins => r.lead_time_minutes)
           between window_start and window_end)
    or
    -- Recurring: always return; the edge function expands the RRULE.
    td.rrule is not null;
$$;

revoke all on function public.fetch_task_dispatch_candidates(timestamptz, timestamptz) from public;
grant execute on function public.fetch_task_dispatch_candidates(timestamptz, timestamptz) to service_role;
