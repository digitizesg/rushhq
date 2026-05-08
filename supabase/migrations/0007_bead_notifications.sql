-- Bead notifications
-- ====================
-- Two new event types fire from the beads module:
--
--   bead_chart_published  — when a chart's effective_until is set
--                           on the previous chart (i.e. a fresh chart
--                           goes live). Notifies parents + the child.
--   bead_period_locked    — when a period transitions to counted.
--                           Notifies parents.
--
-- The dispatcher runs every 5 minutes. Calendar reminders are
-- expanded from RRULEs server-side; bead events are one-shot inserts
-- into a new notification_outbox table. The dispatcher drains both.

create table notification_outbox (
  id           uuid primary key default gen_random_uuid(),
  event_type   notification_event_type not null,
  member_id    uuid not null references family_members(id) on delete cascade,
  payload      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  processed_at timestamptz,
  attempts     int not null default 0,
  last_error   text
);

create index notification_outbox_unprocessed_idx
  on notification_outbox (created_at)
  where processed_at is null;

-- ----------------------------------------------------------------------------
-- RPCs that enqueue
-- ----------------------------------------------------------------------------

-- Re-define clone_bead_chart so it pushes a 'bead_chart_published'
-- event onto the outbox after creating the new chart.
create or replace function public.clone_bead_chart(
  p_child_id        uuid,
  p_effective_from  date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_chart_id  uuid;
  v_new_chart_id  uuid;
  v_child_name    text;
begin
  if not public.is_parent() then
    raise exception 'Only parents can clone bead charts';
  end if;
  if p_effective_from is null then
    raise exception 'effective_from is required';
  end if;

  update bead_charts
     set effective_until = p_effective_from - 1
   where member_id = p_child_id
     and effective_until is null
   returning id into v_old_chart_id;

  insert into bead_charts (member_id, effective_from)
  values (p_child_id, p_effective_from)
  returning id into v_new_chart_id;

  if v_old_chart_id is not null then
    insert into bead_chart_items
      (chart_id, bead_colour_id, description, display_order)
    select
      v_new_chart_id, bead_colour_id, description, display_order
    from bead_chart_items
    where chart_id = v_old_chart_id
    order by display_order, created_at;
  end if;

  -- Notify parents and the child themselves about the new chart.
  select short_name into v_child_name from family_members where id = p_child_id;

  insert into notification_outbox (event_type, member_id, payload)
  select
    'bead_chart_published'::notification_event_type,
    fm.id,
    jsonb_build_object(
      'child_id',         p_child_id,
      'child_short_name', v_child_name,
      'chart_id',         v_new_chart_id,
      'effective_from',   p_effective_from
    )
  from family_members fm
  where fm.active = true
    and (fm.role = 'parent' or fm.id = p_child_id);

  return v_new_chart_id;
end;
$$;

grant execute on function public.clone_bead_chart(uuid, date) to authenticated;

-- Re-define lock_bead_period so it pushes a 'bead_period_locked'
-- event onto the outbox.
create or replace function public.lock_bead_period(p_period_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id    uuid;
  v_member_id    uuid;
  v_period_start date;
  v_total        numeric;
  v_child_name   text;
begin
  if not public.is_parent() then
    raise exception 'Only parents can lock bead periods';
  end if;
  v_caller_id := public.current_member_id();

  update bead_periods
     set status     = 'counted',
         locked_at  = now(),
         locked_by  = v_caller_id
   where id = p_period_id and status = 'open'
   returning member_id, period_start into v_member_id, v_period_start;

  if not found then
    raise exception 'Period % not found or already locked', p_period_id;
  end if;

  select total_sgd into v_total
    from bead_period_totals
   where period_id = p_period_id;

  select short_name into v_child_name from family_members where id = v_member_id;

  insert into notification_outbox (event_type, member_id, payload)
  select
    'bead_period_locked'::notification_event_type,
    fm.id,
    jsonb_build_object(
      'child_id',         v_member_id,
      'child_short_name', v_child_name,
      'period_id',        p_period_id,
      'period_start',     v_period_start,
      'total_sgd',        v_total
    )
  from family_members fm
  where fm.active = true
    and fm.role = 'parent';
end;
$$;

grant execute on function public.lock_bead_period(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- A helper view the dispatcher reads. Joins outbox + recipient
-- contact info + notification preferences in one shot.
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
  coalesce(np.telegram_enabled, true) as telegram_enabled,
  coalesce(np.email_enabled,    true) as email_enabled
from notification_outbox o
join family_members fm on fm.id = o.member_id and fm.active = true
left join telegram_contacts tc on tc.member_id = fm.id
left join notification_preferences np
  on np.member_id = fm.id and np.event_type = o.event_type
where o.processed_at is null;

revoke all on notification_outbox_pending from public;
grant select on notification_outbox_pending to service_role;

-- ----------------------------------------------------------------------------
-- RLS — outbox is service-role only, but parents can read for visibility
-- ----------------------------------------------------------------------------

alter table notification_outbox enable row level security;

create policy "Parents read notification_outbox"
  on notification_outbox for select
  to authenticated
  using (public.is_parent());
-- No write policies = writes only via the RPCs above (security definer)
-- or via service-role.
