-- Rush HQ — Beads module
-- =======================
-- Riley & Robin's monthly reward system. Each child has a versioned
-- chart of tasks; each task is worth a coloured bead with a fixed SGD
-- value. At month-end, parents tip the jar, count by colour, lock the
-- period, and the stocks module (later) buys VOO with the SGD total.
--
-- Tables added:
--   bead_colours        seeded reference: white..sparkly_pink, fixed SGD values
--   bead_categories     seeded reference: 5 default categories with lucide icons
--   bead_charts         versioned per child; effective_until null = active
--   bead_chart_items    items inside a chart, FK to category + colour
--   bead_periods        one row per child per month; status open/counted/invested
--   bead_counts         (period × colour) → count of beads
--
-- Plus a view bead_period_totals for the SGD-per-period sum, and four
-- RPCs the React UI calls: clone_bead_chart, ensure_bead_period,
-- lock_bead_period, reopen_bead_period.
--
-- Notification enum gets two new values for chart-published and
-- period-locked events (the dispatcher extension lives in a follow-up
-- migration).

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------

create type bead_period_status as enum ('open', 'counted', 'invested');

alter type notification_event_type add value if not exists 'bead_chart_published';
alter type notification_event_type add value if not exists 'bead_period_locked';

-- ----------------------------------------------------------------------------
-- bead_colours — seeded reference data
-- ----------------------------------------------------------------------------

create table bead_colours (
  id             text primary key,
  name           text not null,
  hex            text not null,
  sgd_value      numeric(10, 2) not null check (sgd_value > 0),
  display_order  int not null
);

insert into bead_colours (id, name, hex, sgd_value, display_order) values
  ('white',        'White',         '#FFFFFF',  0.20, 1),
  ('yellow',       'Yellow',        '#FACC15',  0.50, 2),
  ('green',        'Green',         '#22C55E',  1.00, 3),
  ('pink',         'Pink',          '#F48BA7',  2.00, 4),
  ('blue',         'Blue',          '#3B82F6',  5.00, 5),
  ('sparkly_pink', 'Sparkly Pink',  '#EC4899', 10.00, 6);

comment on table bead_colours is
  'Fixed reference data. Hex + SGD values match the printed family chart. UI must never offer edits.';

-- ----------------------------------------------------------------------------
-- bead_categories — seeded with 5 defaults, parents can add more
-- ----------------------------------------------------------------------------

create table bead_categories (
  id             text primary key,
  name           text not null,
  icon           text not null,        -- lucide-react component name
  display_order  int not null
);

insert into bead_categories (id, name, icon, display_order) values
  ('daily',        'Daily Habits',         'Sun',      1),
  ('school',       'School & Learning',    'BookOpen', 2),
  ('achievements', 'Achievements & Bonus', 'Trophy',   3),
  ('fitness',      'Fitness & Sport',      'Activity', 4),
  ('character',    'Character',            'Heart',    5);

comment on column bead_categories.icon is
  'Name of a lucide-react export (Sun, BookOpen, Trophy, Activity, Heart, etc.). UI looks up by string.';

-- ----------------------------------------------------------------------------
-- bead_charts — versioned per child
-- ----------------------------------------------------------------------------

create table bead_charts (
  id               uuid primary key default gen_random_uuid(),
  member_id        uuid not null references family_members(id) on delete cascade,
  effective_from   date not null,
  effective_until  date,                -- null = currently active
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (member_id, effective_from),
  check (effective_until is null or effective_until >= effective_from)
);

-- Only one active chart per member at a time.
create unique index bead_charts_one_active_per_member_idx
  on bead_charts (member_id) where effective_until is null;

create index bead_charts_member_idx on bead_charts (member_id, effective_from desc);

-- ----------------------------------------------------------------------------
-- bead_chart_items
-- ----------------------------------------------------------------------------

create table bead_chart_items (
  id              uuid primary key default gen_random_uuid(),
  chart_id        uuid not null references bead_charts(id) on delete cascade,
  category_id     text not null references bead_categories(id),
  bead_colour_id  text not null references bead_colours(id),
  description     text not null check (length(description) between 1 and 500),
  display_order   int  not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index bead_chart_items_chart_idx on bead_chart_items (chart_id, display_order);

-- ----------------------------------------------------------------------------
-- bead_periods — one row per child per month
-- ----------------------------------------------------------------------------

create table bead_periods (
  id                       uuid primary key default gen_random_uuid(),
  member_id                uuid not null references family_members(id) on delete cascade,
  period_start             date not null,
  status                   bead_period_status not null default 'open',
  notes                    text,
  locked_at                timestamptz,
  locked_by                uuid references family_members(id),
  invested_at              timestamptz,
  invested_transaction_id  uuid,        -- forward ref to stocks module; no FK yet
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (member_id, period_start),
  check (extract(day from period_start) = 1)
);

create index bead_periods_member_idx on bead_periods (member_id, period_start desc);

comment on column bead_periods.invested_transaction_id is
  'Set by the stocks module when the SGD total is converted to VOO shares. Until then the period is "ready to invest".';

-- ----------------------------------------------------------------------------
-- bead_counts — (period × colour) → count
-- ----------------------------------------------------------------------------

create table bead_counts (
  period_id       uuid not null references bead_periods(id) on delete cascade,
  bead_colour_id  text not null references bead_colours(id),
  count           int  not null default 0 check (count >= 0),
  updated_at      timestamptz not null default now(),
  primary key (period_id, bead_colour_id)
);

-- ----------------------------------------------------------------------------
-- view: total SGD per period
-- ----------------------------------------------------------------------------

create or replace view bead_period_totals as
select
  bp.id           as period_id,
  bp.member_id,
  bp.period_start,
  bp.status,
  bp.locked_at,
  bp.invested_at,
  coalesce(sum(bc.count * b.sgd_value), 0)::numeric(10, 2) as total_sgd
from bead_periods bp
left join bead_counts bc on bc.period_id = bp.id
left join bead_colours b on b.id = bc.bead_colour_id
group by bp.id;

-- ----------------------------------------------------------------------------
-- updated_at triggers
-- ----------------------------------------------------------------------------

create trigger bead_charts_touch_updated_at
  before update on bead_charts
  for each row execute function public.touch_updated_at();

create trigger bead_chart_items_touch_updated_at
  before update on bead_chart_items
  for each row execute function public.touch_updated_at();

create trigger bead_periods_touch_updated_at
  before update on bead_periods
  for each row execute function public.touch_updated_at();

create trigger bead_counts_touch_updated_at
  before update on bead_counts
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------

alter table bead_colours      enable row level security;
alter table bead_categories   enable row level security;
alter table bead_charts       enable row level security;
alter table bead_chart_items  enable row level security;
alter table bead_periods      enable row level security;
alter table bead_counts       enable row level security;

-- bead_colours / bead_categories: read for anyone authenticated.
-- No insert/update/delete policy means writes are denied (matches the
-- guardrail "Don't allow editing of bead_colours in any UI").
create policy "Authenticated reads bead_colours"
  on bead_colours for select
  to authenticated
  using (true);

create policy "Authenticated reads bead_categories"
  on bead_categories for select
  to authenticated
  using (true);

-- Parents can add new categories from the chart UI; they can't edit
-- the seeded reference colours (no policy = deny).
create policy "Parents manage bead_categories"
  on bead_categories for all
  to authenticated
  using (public.is_parent())
  with check (public.is_parent());

-- bead_charts: parents manage; child reads own.
create policy "Parents manage bead_charts"
  on bead_charts for all
  to authenticated
  using (public.is_parent())
  with check (public.is_parent());

create policy "Child reads own bead_charts"
  on bead_charts for select
  to authenticated
  using (member_id = public.current_member_id());

-- bead_chart_items: parents manage; child reads items of their own charts.
create policy "Parents manage bead_chart_items"
  on bead_chart_items for all
  to authenticated
  using (public.is_parent())
  with check (public.is_parent());

create policy "Child reads own bead_chart_items"
  on bead_chart_items for select
  to authenticated
  using (
    exists (
      select 1 from bead_charts c
      where c.id = bead_chart_items.chart_id
        and c.member_id = public.current_member_id()
    )
  );

-- bead_periods: parents manage; child reads own.
create policy "Parents manage bead_periods"
  on bead_periods for all
  to authenticated
  using (public.is_parent())
  with check (public.is_parent());

create policy "Child reads own bead_periods"
  on bead_periods for select
  to authenticated
  using (member_id = public.current_member_id());

-- bead_counts: parents manage; child reads own.
create policy "Parents manage bead_counts"
  on bead_counts for all
  to authenticated
  using (public.is_parent())
  with check (public.is_parent());

create policy "Child reads own bead_counts"
  on bead_counts for select
  to authenticated
  using (
    exists (
      select 1 from bead_periods p
      where p.id = bead_counts.period_id
        and p.member_id = public.current_member_id()
    )
  );

-- ----------------------------------------------------------------------------
-- RPCs
-- ----------------------------------------------------------------------------

-- clone_bead_chart: closes the active chart and creates a fresh one
-- starting at p_effective_from. Items are copied across (display
-- order preserved). Returns the new chart's id.
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
begin
  if not public.is_parent() then
    raise exception 'Only parents can clone bead charts';
  end if;
  if p_effective_from is null then
    raise exception 'effective_from is required';
  end if;

  -- Close the active chart, if any. Effective_until is the day before
  -- the new chart starts so the two never overlap.
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
      (chart_id, category_id, bead_colour_id, description, display_order)
    select
      v_new_chart_id, category_id, bead_colour_id, description, display_order
    from bead_chart_items
    where chart_id = v_old_chart_id
    order by display_order, created_at;
  end if;

  return v_new_chart_id;
end;
$$;

grant execute on function public.clone_bead_chart(uuid, date) to authenticated;

-- ensure_bead_period: idempotent get-or-create for the (child, month).
-- Returns the period id either way.
create or replace function public.ensure_bead_period(
  p_child_id      uuid,
  p_period_start  date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period_id uuid;
begin
  if not public.is_parent() then
    raise exception 'Only parents can ensure bead periods';
  end if;
  if extract(day from p_period_start) <> 1 then
    raise exception 'period_start must be the first of a month';
  end if;

  select id into v_period_id
    from bead_periods
   where member_id = p_child_id and period_start = p_period_start;

  if v_period_id is null then
    insert into bead_periods (member_id, period_start)
    values (p_child_id, p_period_start)
    returning id into v_period_id;
  end if;

  return v_period_id;
end;
$$;

grant execute on function public.ensure_bead_period(uuid, date) to authenticated;

-- lock_bead_period: open → counted. Records who locked + when.
create or replace function public.lock_bead_period(p_period_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id uuid;
begin
  if not public.is_parent() then
    raise exception 'Only parents can lock bead periods';
  end if;
  v_caller_id := public.current_member_id();

  update bead_periods
     set status     = 'counted',
         locked_at  = now(),
         locked_by  = v_caller_id
   where id = p_period_id and status = 'open';

  if not found then
    raise exception 'Period % not found or already locked', p_period_id;
  end if;
end;
$$;

grant execute on function public.lock_bead_period(uuid) to authenticated;

-- reopen_bead_period: counted → open. Refuses if the period has been
-- invested (data is downstream-immutable at that point).
create or replace function public.reopen_bead_period(p_period_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_parent() then
    raise exception 'Only parents can reopen bead periods';
  end if;

  update bead_periods
     set status     = 'open',
         locked_at  = null,
         locked_by  = null
   where id = p_period_id and status = 'counted';

  if not found then
    raise exception 'Period % not found, or is not in counted status', p_period_id;
  end if;
end;
$$;

grant execute on function public.reopen_bead_period(uuid) to authenticated;
