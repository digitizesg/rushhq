-- Rush HQ — Properties module
-- ============================
-- Tracks the family's three mortgaged properties (one HDB, two
-- commercial). Same monthly snapshot pattern as bank accounts:
-- properties holds the slow-changing facts, property_snapshots the
-- per-month outstanding loan + market value estimate. Equity is
-- derived (market_value - amount_outstanding).
--
-- Parents-only at every layer.

create type property_category as enum ('personal', 'commercial');

-- ----------------------------------------------------------------------------
-- properties — slow-changing roster
-- ----------------------------------------------------------------------------

create table properties (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  short_name      text not null,
  category        property_category not null,
  -- Acquisition + loan facts (filled in from the loan offer letter).
  -- Nullable so a row can be added before all the paperwork is to hand.
  purchase_price  numeric(14, 2),
  purchase_date   date,
  total_loan      numeric(14, 2),
  tenure_months   integer check (tenure_months is null or tenure_months > 0),
  interest_rate   numeric(6, 4) check (interest_rate is null or interest_rate >= 0),
  rate_end_date   date,
  notes           text,
  display_order   int  not null,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

insert into properties (name, short_name, category, display_order) values
  ('HDB / Home',     'HDB',      'personal',   1),
  ('Cendex Centre',  'Cendex',   'commercial', 2),
  ('Toh Guan',       'Toh Guan', 'commercial', 3);

create trigger properties_touch_updated_at
  before update on properties
  for each row execute function public.touch_updated_at();

comment on table properties is
  'Mortgaged properties — slow-changing facts. Outstanding loan + market value live in property_snapshots.';

-- ----------------------------------------------------------------------------
-- property_snapshots — one row per (property × month)
-- ----------------------------------------------------------------------------

create table property_snapshots (
  id                       uuid primary key default gen_random_uuid(),
  property_id              uuid not null references properties(id) on delete cascade,
  snapshot_month           date not null,
  amount_outstanding_sgd   numeric(14, 2) not null default 0,
  -- Optional: only set when the user re-estimates market value. Carries
  -- forward via prefill so charts have continuous lines.
  market_value_sgd         numeric(14, 2),
  notes                    text,
  created_by               uuid references family_members(id),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (property_id, snapshot_month),
  check (extract(day from snapshot_month) = 1)
);

create index property_snapshots_month_idx on property_snapshots (snapshot_month desc);

create trigger property_snapshots_touch_updated_at
  before update on property_snapshots
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- total_property_equity_over_time view — drives the chart
-- ----------------------------------------------------------------------------

create or replace view total_property_equity_over_time as
select
  s.snapshot_month,
  sum(coalesce(s.market_value_sgd, 0) - s.amount_outstanding_sgd)::numeric(14, 2) as total_equity_sgd,
  sum(s.amount_outstanding_sgd)::numeric(14, 2)                                    as total_outstanding_sgd,
  sum(coalesce(s.market_value_sgd, 0))::numeric(14, 2)                             as total_value_sgd
from property_snapshots s
join properties p on p.id = s.property_id and p.active = true
group by s.snapshot_month
order by s.snapshot_month;

-- ----------------------------------------------------------------------------
-- prefill_property_month_from_previous: idempotent monthly bootstrap
-- ----------------------------------------------------------------------------

create or replace function public.prefill_property_month_from_previous(p_month date)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted int;
  v_caller_id uuid;
begin
  if not public.is_parent() then
    raise exception 'Only parents can manage properties';
  end if;
  if extract(day from p_month) <> 1 then
    raise exception 'month must be the first of a month';
  end if;
  v_caller_id := public.current_member_id();

  with prev as (
    select s.property_id, s.amount_outstanding_sgd, s.market_value_sgd
      from property_snapshots s
      join properties p on p.id = s.property_id and p.active = true
     where s.snapshot_month = (
       select max(snapshot_month) from property_snapshots where snapshot_month < p_month
     )
  ),
  src as (
    select p.id as property_id,
           coalesce(prev.amount_outstanding_sgd, 0) as amount_outstanding_sgd,
           prev.market_value_sgd
      from properties p
      left join prev on prev.property_id = p.id
     where p.active = true
  )
  insert into property_snapshots (
    property_id, snapshot_month,
    amount_outstanding_sgd, market_value_sgd, created_by
  )
  select s.property_id, p_month, s.amount_outstanding_sgd, s.market_value_sgd, v_caller_id
    from src s
   where not exists (
     select 1 from property_snapshots existing
      where existing.property_id = s.property_id
        and existing.snapshot_month = p_month
   );

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

grant execute on function public.prefill_property_month_from_previous(date) to authenticated;

-- ----------------------------------------------------------------------------
-- RLS — parents only
-- ----------------------------------------------------------------------------

alter table properties          enable row level security;
alter table property_snapshots  enable row level security;

create policy "Parents manage properties"
  on properties for all
  to authenticated
  using (public.is_parent()) with check (public.is_parent());

create policy "Parents manage property_snapshots"
  on property_snapshots for all
  to authenticated
  using (public.is_parent()) with check (public.is_parent());
