-- Rush HQ — Finance module
-- =========================
-- Monthly bank balance snapshots across the family's eight accounts.
-- Parents-only at every layer (RLS, policies, no nav for non-parents).
-- This is a balance-sheet snapshot tool, not accounting software.

create type account_type as enum (
  'personal',
  'business',
  'investment'
);

alter type notification_event_type add value if not exists 'finance_monthly_reminder';

-- ----------------------------------------------------------------------------
-- accounts — the eight accounts seeded below
-- ----------------------------------------------------------------------------

create table accounts (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  entity         text not null,
  account_type   account_type not null,
  currency       text not null default 'SGD',
  display_order  int  not null,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

insert into accounts (name, entity, account_type, display_order) values
  ('Personal',           'Family',                  'personal',   1),
  ('Digitize',           'Digitize Pte Ltd',        'business',   2),
  ('Asian Art Platform', 'Asian Art Platform',      'business',   3),
  ('Notary Translations','Notary Translations',     'business',   4),
  ('Art Framing Group',  'Art Framing Group',       'business',   5),
  ('FrameIt',            'FrameIt',                 'business',   6),
  ('RZR',                'RZR',                     'business',   7),
  ('Moomoo',             'Personal · Brokerage',    'investment', 8);

create trigger accounts_touch_updated_at
  before update on accounts
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- account_snapshots — one row per (account × month)
-- ----------------------------------------------------------------------------

create table account_snapshots (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references accounts(id) on delete cascade,
  snapshot_month date not null,                  -- always first-of-month
  balance_sgd    numeric(14, 2) not null default 0,
  notes          text,
  created_by     uuid references family_members(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (account_id, snapshot_month),
  check (extract(day from snapshot_month) = 1)
);

create index account_snapshots_month_idx on account_snapshots (snapshot_month desc);

create trigger account_snapshots_touch_updated_at
  before update on account_snapshots
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- total_assets_over_time view — drives the chart
-- ----------------------------------------------------------------------------

create or replace view total_assets_over_time as
select
  s.snapshot_month,
  sum(s.balance_sgd)::numeric(14, 2) as total_sgd
from account_snapshots s
join accounts a on a.id = s.account_id and a.active = true
group by s.snapshot_month
order by s.snapshot_month;

-- ----------------------------------------------------------------------------
-- prefill_month_from_previous: idempotent monthly bootstrap
-- ----------------------------------------------------------------------------

create or replace function public.prefill_month_from_previous(p_month date)
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
    raise exception 'Only parents can manage finance';
  end if;
  if extract(day from p_month) <> 1 then
    raise exception 'month must be the first of a month';
  end if;
  v_caller_id := public.current_member_id();

  with prev as (
    select s.account_id, s.balance_sgd
      from account_snapshots s
      join accounts a on a.id = s.account_id and a.active = true
     where s.snapshot_month = (
       select max(snapshot_month) from account_snapshots where snapshot_month < p_month
     )
  ),
  src as (
    select a.id as account_id,
           coalesce(p.balance_sgd, 0) as balance_sgd
      from accounts a
      left join prev p on p.account_id = a.id
     where a.active = true
  )
  insert into account_snapshots (account_id, snapshot_month, balance_sgd, created_by)
  select s.account_id, p_month, s.balance_sgd, v_caller_id
    from src s
   where not exists (
     select 1 from account_snapshots existing
      where existing.account_id = s.account_id
        and existing.snapshot_month = p_month
   );

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

grant execute on function public.prefill_month_from_previous(date) to authenticated;

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------

alter table accounts          enable row level security;
alter table account_snapshots enable row level security;

-- Parents-only on both tables — no read or write for helpers / children.
create policy "Parents manage accounts"
  on accounts for all
  to authenticated
  using (public.is_parent()) with check (public.is_parent());

create policy "Parents manage account_snapshots"
  on account_snapshots for all
  to authenticated
  using (public.is_parent()) with check (public.is_parent());
