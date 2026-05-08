-- Rush HQ — Stocks module
-- ========================
-- VOO ETF tracking per child. The user enters what already happened
-- on moomoo; we never call a brokerage. Money flows in via:
--
--   - bead_purchase     monthly bead-funded buy, allocated pro-rata
--                       across kids by their counted bead totals
--   - gift_purchase     adhoc gift money allocated to one kid
--   - dividend_reinvest quarterly VOO dividend reinvested, pro-rata
--                       by current holdings
--
-- Out via:
--   - withdrawal        rare; reduces shares + cost basis
--
-- Source of truth is USD (VOO is a USD asset). FX rate is per-transaction
-- so historical cost basis stays accurate even if SGD moves.

create type stock_transaction_type as enum (
  'bead_purchase',
  'gift_purchase',
  'dividend_reinvest',
  'withdrawal'
);

create type stock_allocation_source as enum (
  'bead_period',
  'pending_deposit',
  'dividend',
  'withdrawal'
);

create type pending_deposit_status as enum ('pending', 'invested', 'cancelled');

alter type notification_event_type add value if not exists 'stock_purchase_recorded';
alter type notification_event_type add value if not exists 'stock_monthly_summary';

-- ----------------------------------------------------------------------------
-- price_cache — VOO + FX upsert target for refresh-prices
-- ----------------------------------------------------------------------------

create table price_cache (
  symbol        text primary key,        -- 'VOO' or 'USDSGD'
  price         numeric(18, 6) not null check (price >= 0),
  last_updated  timestamptz not null default now()
);

-- Seed with sane defaults so the UI doesn't NaN on a fresh project
-- before the first cron run.
insert into price_cache (symbol, price) values
  ('VOO',    0),
  ('USDSGD', 0)
on conflict (symbol) do nothing;

alter table price_cache enable row level security;
create policy "Authenticated reads price_cache" on price_cache for select
  to authenticated using (true);
-- Writes are service-role only.

-- ----------------------------------------------------------------------------
-- pending_deposits — adhoc gift money waiting for the next purchase
-- ----------------------------------------------------------------------------

create table pending_deposits (
  id              uuid primary key default gen_random_uuid(),
  member_id       uuid not null references family_members(id) on delete cascade,
  amount_sgd      numeric(12, 2) not null check (amount_sgd > 0),
  source          text not null check (length(source) between 1 and 200),
  received_date   date not null,
  status          pending_deposit_status not null default 'pending',
  invested_transaction_id uuid,           -- FK added below to break the cycle
  created_by      uuid not null references family_members(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index pending_deposits_member_status_idx
  on pending_deposits (member_id, status, received_date desc);

create trigger pending_deposits_touch_updated_at
  before update on pending_deposits
  for each row execute function public.touch_updated_at();

alter table pending_deposits enable row level security;
create policy "Parents manage pending_deposits"
  on pending_deposits for all
  to authenticated
  using (public.is_parent()) with check (public.is_parent());
create policy "Child reads own pending_deposits"
  on pending_deposits for select
  to authenticated
  using (member_id = public.current_member_id());

-- ----------------------------------------------------------------------------
-- stock_transactions — one row per recorded buy / sell / dividend
-- ----------------------------------------------------------------------------

create table stock_transactions (
  id                  uuid primary key default gen_random_uuid(),
  transaction_type    stock_transaction_type not null,
  transaction_date    date not null,
  total_shares        numeric(18, 6) not null,         -- signed (negative = withdrawal)
  price_per_share_usd numeric(12, 4) not null check (price_per_share_usd > 0),
  usd_to_sgd_rate     numeric(10, 6) not null check (usd_to_sgd_rate > 0),
  notes               text,
  created_by          uuid not null references family_members(id),
  created_at          timestamptz not null default now(),
  -- Generated convenience columns. Total USD is sign-preserving so a
  -- withdrawal row's total_usd is negative, matching shares.
  total_usd numeric(14, 4) generated always as
    (total_shares * price_per_share_usd) stored,
  total_sgd numeric(14, 2) generated always as
    (total_shares * price_per_share_usd * usd_to_sgd_rate) stored
);

create index stock_transactions_date_idx on stock_transactions (transaction_date desc);

alter table stock_transactions enable row level security;
create policy "Parents manage stock_transactions"
  on stock_transactions for all
  to authenticated
  using (public.is_parent()) with check (public.is_parent());

-- ----------------------------------------------------------------------------
-- stock_allocations — splits each transaction across children
-- ----------------------------------------------------------------------------

create table stock_allocations (
  id              uuid primary key default gen_random_uuid(),
  transaction_id  uuid not null references stock_transactions(id) on delete cascade,
  member_id       uuid not null references family_members(id) on delete restrict,
  shares          numeric(18, 6) not null,             -- signed
  cost_sgd        numeric(14, 2) not null,             -- signed
  cost_usd        numeric(14, 4) not null,             -- signed
  source_type     stock_allocation_source not null,
  source_id       uuid,                                -- bead_period_id or pending_deposit_id; null otherwise
  created_at      timestamptz not null default now()
);

create index stock_allocations_member_idx on stock_allocations (member_id);
create index stock_allocations_transaction_idx on stock_allocations (transaction_id);

alter table stock_allocations enable row level security;
create policy "Parents manage stock_allocations"
  on stock_allocations for all
  to authenticated
  using (public.is_parent()) with check (public.is_parent());
create policy "Child reads own stock_allocations"
  on stock_allocations for select
  to authenticated
  using (member_id = public.current_member_id());

-- Late FK on pending_deposits.invested_transaction_id (table now exists).
alter table pending_deposits
  add constraint pending_deposits_invested_transaction_fk
  foreign key (invested_transaction_id)
  references stock_transactions(id) on delete set null;

-- Late FK on bead_periods.invested_transaction_id (forward-declared in 0005).
alter table bead_periods
  add constraint bead_periods_invested_transaction_fk
  foreign key (invested_transaction_id)
  references stock_transactions(id) on delete set null;

-- ----------------------------------------------------------------------------
-- portfolio_snapshots — monthly per-child point-in-time
-- ----------------------------------------------------------------------------

create table portfolio_snapshots (
  id                       uuid primary key default gen_random_uuid(),
  member_id                uuid not null references family_members(id) on delete cascade,
  snapshot_date            date not null,
  shares_held              numeric(18, 6) not null,
  cost_basis_usd           numeric(14, 4) not null,
  cost_basis_sgd           numeric(14, 2) not null,
  price_usd_at_snapshot    numeric(12, 4) not null,
  fx_at_snapshot           numeric(10, 6) not null,
  value_usd                numeric(14, 4) generated always as
                             (shares_held * price_usd_at_snapshot) stored,
  value_sgd                numeric(14, 2) generated always as
                             (shares_held * price_usd_at_snapshot * fx_at_snapshot) stored,
  created_at               timestamptz not null default now(),
  unique (member_id, snapshot_date)
);

create index portfolio_snapshots_member_date_idx
  on portfolio_snapshots (member_id, snapshot_date desc);

alter table portfolio_snapshots enable row level security;
create policy "Parents read portfolio_snapshots"
  on portfolio_snapshots for select
  to authenticated
  using (public.is_parent());
create policy "Child reads own portfolio_snapshots"
  on portfolio_snapshots for select
  to authenticated
  using (member_id = public.current_member_id());
-- Writes via service-role only.

-- ----------------------------------------------------------------------------
-- child_holdings view — current per-child position
-- ----------------------------------------------------------------------------

create or replace view child_holdings as
select
  fm.id            as member_id,
  fm.short_name,
  coalesce(sum(a.shares),    0)::numeric(18, 6) as shares_held,
  coalesce(sum(a.cost_sgd),  0)::numeric(14, 2) as cost_basis_sgd,
  coalesce(sum(a.cost_usd),  0)::numeric(14, 4) as cost_basis_usd
from family_members fm
left join stock_allocations a on a.member_id = fm.id
where fm.member_type = 'child'
group by fm.id, fm.short_name;

-- ----------------------------------------------------------------------------
-- RPC: record_bead_purchase
-- Allocates a single transaction across counted bead periods + pending
-- deposits pro-rata by SGD share. Marks bead_periods invested and
-- pending_deposits invested.
-- ----------------------------------------------------------------------------

create or replace function public.record_bead_purchase(
  p_total_shares         numeric,
  p_price_per_share_usd  numeric,
  p_usd_to_sgd_rate      numeric,
  p_transaction_date     date,
  p_bead_period_ids      uuid[],
  p_pending_deposit_ids  uuid[],
  p_notes                text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id    uuid;
  v_tx_id        uuid;
  v_total_sgd    numeric;
  v_period_total numeric;
  v_pending_total numeric;
  v_grand_total   numeric;
  v_share_factor  numeric;   -- shares per SGD
begin
  if not public.is_parent() then
    raise exception 'Only parents can record stock purchases';
  end if;
  v_caller_id := public.current_member_id();

  if p_total_shares <= 0 then raise exception 'total_shares must be positive'; end if;
  if p_price_per_share_usd <= 0 then raise exception 'price_per_share_usd must be positive'; end if;
  if p_usd_to_sgd_rate <= 0 then raise exception 'usd_to_sgd_rate must be positive'; end if;

  v_total_sgd := p_total_shares * p_price_per_share_usd * p_usd_to_sgd_rate;

  -- Sum SGD across all selected sources. Grand total must equal the
  -- buy's SGD value (within rounding); we don't enforce equality
  -- because the UI is responsible for matching.
  select coalesce(sum(t.total_sgd), 0) into v_period_total
    from bead_period_totals t
   where t.period_id = any(coalesce(p_bead_period_ids, '{}'::uuid[]))
     and t.status = 'counted';

  select coalesce(sum(d.amount_sgd), 0) into v_pending_total
    from pending_deposits d
   where d.id = any(coalesce(p_pending_deposit_ids, '{}'::uuid[]))
     and d.status = 'pending';

  v_grand_total := v_period_total + v_pending_total;
  if v_grand_total <= 0 then
    raise exception 'No counted periods or pending deposits selected';
  end if;

  -- shares per SGD of the input pool
  v_share_factor := p_total_shares / v_grand_total;

  -- Insert the transaction.
  insert into stock_transactions (
    transaction_type, transaction_date, total_shares,
    price_per_share_usd, usd_to_sgd_rate, notes, created_by
  )
  values (
    'bead_purchase', p_transaction_date, p_total_shares,
    p_price_per_share_usd, p_usd_to_sgd_rate, p_notes, v_caller_id
  )
  returning id into v_tx_id;

  -- Allocations from bead_periods. Cost SGD is the bead total; shares
  -- and cost USD derive from the share factor.
  insert into stock_allocations (
    transaction_id, member_id, shares, cost_sgd, cost_usd, source_type, source_id
  )
  select
    v_tx_id, bp.member_id,
    round((t.total_sgd * v_share_factor)::numeric, 6),
    t.total_sgd,
    round((t.total_sgd / p_usd_to_sgd_rate)::numeric, 4),
    'bead_period'::stock_allocation_source,
    bp.id
  from bead_periods bp
  join bead_period_totals t on t.period_id = bp.id
  where bp.id = any(p_bead_period_ids) and t.status = 'counted' and t.total_sgd > 0;

  -- Allocations from pending deposits.
  insert into stock_allocations (
    transaction_id, member_id, shares, cost_sgd, cost_usd, source_type, source_id
  )
  select
    v_tx_id, d.member_id,
    round((d.amount_sgd * v_share_factor)::numeric, 6),
    d.amount_sgd,
    round((d.amount_sgd / p_usd_to_sgd_rate)::numeric, 4),
    'pending_deposit'::stock_allocation_source,
    d.id
  from pending_deposits d
  where d.id = any(p_pending_deposit_ids) and d.status = 'pending';

  -- Mark bead periods invested.
  update bead_periods
     set status = 'invested',
         invested_at = now(),
         invested_transaction_id = v_tx_id
   where id = any(p_bead_period_ids) and status = 'counted';

  -- Mark pending deposits invested.
  update pending_deposits
     set status = 'invested',
         invested_transaction_id = v_tx_id
   where id = any(p_pending_deposit_ids) and status = 'pending';

  -- Notify parents.
  insert into notification_outbox (event_type, member_id, payload)
  select 'stock_purchase_recorded'::notification_event_type, fm.id,
         jsonb_build_object(
           'transaction_id',   v_tx_id,
           'transaction_type', 'bead_purchase',
           'total_shares',     p_total_shares,
           'total_sgd',        v_total_sgd
         )
    from family_members fm
   where fm.role = 'parent' and fm.active = true;

  return v_tx_id;
end;
$$;

grant execute on function public.record_bead_purchase(numeric, numeric, numeric, date, uuid[], uuid[], text) to authenticated;

-- ----------------------------------------------------------------------------
-- RPC: record_gift_purchase
-- Single-child, single-allocation buy (no beads, no pool).
-- ----------------------------------------------------------------------------

create or replace function public.record_gift_purchase(
  p_member_id            uuid,
  p_total_shares         numeric,
  p_price_per_share_usd  numeric,
  p_usd_to_sgd_rate      numeric,
  p_transaction_date     date,
  p_amount_sgd           numeric,
  p_source               text,
  p_notes                text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id uuid;
  v_tx_id     uuid;
begin
  if not public.is_parent() then
    raise exception 'Only parents can record stock purchases';
  end if;
  v_caller_id := public.current_member_id();

  if p_total_shares <= 0 then raise exception 'total_shares must be positive'; end if;
  if p_price_per_share_usd <= 0 then raise exception 'price_per_share_usd must be positive'; end if;
  if p_usd_to_sgd_rate <= 0 then raise exception 'usd_to_sgd_rate must be positive'; end if;
  if p_amount_sgd <= 0 then raise exception 'amount_sgd must be positive'; end if;

  insert into stock_transactions (
    transaction_type, transaction_date, total_shares,
    price_per_share_usd, usd_to_sgd_rate, notes, created_by
  )
  values (
    'gift_purchase', p_transaction_date, p_total_shares,
    p_price_per_share_usd, p_usd_to_sgd_rate,
    coalesce(p_notes, '') || case when p_source is not null and p_source <> '' then
      case when coalesce(p_notes, '') = '' then '' else E'\n' end || 'Source: ' || p_source
    else '' end,
    v_caller_id
  )
  returning id into v_tx_id;

  insert into stock_allocations (
    transaction_id, member_id, shares, cost_sgd, cost_usd, source_type
  )
  values (
    v_tx_id, p_member_id, p_total_shares, p_amount_sgd,
    round((p_amount_sgd / p_usd_to_sgd_rate)::numeric, 4),
    'pending_deposit'::stock_allocation_source
  );

  insert into notification_outbox (event_type, member_id, payload)
  select 'stock_purchase_recorded'::notification_event_type, fm.id,
         jsonb_build_object(
           'transaction_id',   v_tx_id,
           'transaction_type', 'gift_purchase',
           'total_shares',     p_total_shares,
           'total_sgd',        p_amount_sgd,
           'source',           p_source
         )
    from family_members fm
   where fm.role = 'parent' and fm.active = true;

  return v_tx_id;
end;
$$;

grant execute on function public.record_gift_purchase(uuid, numeric, numeric, numeric, date, numeric, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- RPC: record_dividend_reinvest
-- Allocates a buy pro-rata across kids by current shares held.
-- ----------------------------------------------------------------------------

create or replace function public.record_dividend_reinvest(
  p_total_shares         numeric,
  p_price_per_share_usd  numeric,
  p_usd_to_sgd_rate      numeric,
  p_transaction_date     date,
  p_notes                text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id   uuid;
  v_tx_id       uuid;
  v_total_existing numeric;
begin
  if not public.is_parent() then
    raise exception 'Only parents can record dividends';
  end if;
  v_caller_id := public.current_member_id();

  if p_total_shares <= 0 then raise exception 'total_shares must be positive'; end if;

  select sum(shares_held) into v_total_existing from child_holdings;
  if v_total_existing is null or v_total_existing <= 0 then
    raise exception 'Cannot reinvest a dividend before any shares are held';
  end if;

  insert into stock_transactions (
    transaction_type, transaction_date, total_shares,
    price_per_share_usd, usd_to_sgd_rate, notes, created_by
  )
  values (
    'dividend_reinvest', p_transaction_date, p_total_shares,
    p_price_per_share_usd, p_usd_to_sgd_rate, p_notes, v_caller_id
  )
  returning id into v_tx_id;

  insert into stock_allocations (
    transaction_id, member_id, shares, cost_sgd, cost_usd, source_type
  )
  select
    v_tx_id, h.member_id,
    round((p_total_shares * (h.shares_held / v_total_existing))::numeric, 6),
    round((p_total_shares * (h.shares_held / v_total_existing) * p_price_per_share_usd * p_usd_to_sgd_rate)::numeric, 2),
    round((p_total_shares * (h.shares_held / v_total_existing) * p_price_per_share_usd)::numeric, 4),
    'dividend'::stock_allocation_source
  from child_holdings h
  where h.shares_held > 0;

  insert into notification_outbox (event_type, member_id, payload)
  select 'stock_purchase_recorded'::notification_event_type, fm.id,
         jsonb_build_object(
           'transaction_id',   v_tx_id,
           'transaction_type', 'dividend_reinvest',
           'total_shares',     p_total_shares
         )
    from family_members fm
   where fm.role = 'parent' and fm.active = true;

  return v_tx_id;
end;
$$;

grant execute on function public.record_dividend_reinvest(numeric, numeric, numeric, date, text) to authenticated;

-- ----------------------------------------------------------------------------
-- RPC: record_withdrawal
-- Reduces shares for a single child. Cost basis reduces using the
-- average-cost method.
-- ----------------------------------------------------------------------------

create or replace function public.record_withdrawal(
  p_member_id            uuid,
  p_shares_withdrawn     numeric,                  -- positive number
  p_price_per_share_usd  numeric,
  p_usd_to_sgd_rate      numeric,
  p_transaction_date     date,
  p_notes                text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id    uuid;
  v_tx_id        uuid;
  v_shares_held  numeric;
  v_cost_sgd     numeric;
  v_cost_usd     numeric;
  v_avg_sgd      numeric;
  v_avg_usd      numeric;
begin
  if not public.is_parent() then
    raise exception 'Only parents can record withdrawals';
  end if;
  v_caller_id := public.current_member_id();

  if p_shares_withdrawn <= 0 then raise exception 'shares_withdrawn must be positive'; end if;

  select shares_held, cost_basis_sgd, cost_basis_usd
    into v_shares_held, v_cost_sgd, v_cost_usd
    from child_holdings where member_id = p_member_id;

  if v_shares_held is null or v_shares_held < p_shares_withdrawn then
    raise exception 'Withdrawal exceeds current holdings (% available)', coalesce(v_shares_held, 0);
  end if;

  v_avg_sgd := v_cost_sgd / v_shares_held;
  v_avg_usd := v_cost_usd / v_shares_held;

  insert into stock_transactions (
    transaction_type, transaction_date, total_shares,
    price_per_share_usd, usd_to_sgd_rate, notes, created_by
  )
  values (
    'withdrawal', p_transaction_date, -p_shares_withdrawn,
    p_price_per_share_usd, p_usd_to_sgd_rate, p_notes, v_caller_id
  )
  returning id into v_tx_id;

  insert into stock_allocations (
    transaction_id, member_id, shares, cost_sgd, cost_usd, source_type
  )
  values (
    v_tx_id, p_member_id, -p_shares_withdrawn,
    round((-p_shares_withdrawn * v_avg_sgd)::numeric, 2),
    round((-p_shares_withdrawn * v_avg_usd)::numeric, 4),
    'withdrawal'::stock_allocation_source
  );

  insert into notification_outbox (event_type, member_id, payload)
  select 'stock_purchase_recorded'::notification_event_type, fm.id,
         jsonb_build_object(
           'transaction_id',   v_tx_id,
           'transaction_type', 'withdrawal',
           'total_shares',     -p_shares_withdrawn,
           'member_id',        p_member_id
         )
    from family_members fm
   where fm.role = 'parent' and fm.active = true;

  return v_tx_id;
end;
$$;

grant execute on function public.record_withdrawal(uuid, numeric, numeric, numeric, date, text) to authenticated;
