-- Rush HQ — Income deposits
-- =========================
-- A read-only-in-app mirror of classified bank deposits, used by the
-- Finance → Income sources page (parents only). Rows are produced off-app
-- by the local bank-statement analyser (bank-analysis/export_to_rushhq.py),
-- which parses UOB statement PDFs on Ben's machine, classifies each deposit
-- by payer into an income group (SAP, Digitize, etc.), flags the large /
-- unusual ones, and upserts the results here via the service-role key.
--
-- Deposits only — no withdrawals, and no raw statement PDFs ever leave the
-- machine. The cloud holds only (date, amount, payer, group, large?).
-- Parents-only at every layer, same posture as the rest of Finance.

create table income_deposits (
  id             uuid primary key default gen_random_uuid(),
  txn_date       date not null,
  amount         numeric(14, 2) not null check (amount > 0),
  -- Raw payer / source string from the statement (best-guess counterparty).
  counterparty   text not null default '',
  -- Classified income stream, or '(other)' when no rule matched. The
  -- classification runs locally at export time, so the buckets are curated.
  income_group   text not null default '(other)',
  -- Flagged by the analyser as a large / unusual deposit (statistical
  -- outlier, or above a set threshold).
  is_large       boolean not null default false,
  -- First of the statement month this deposit belongs to (nullable).
  statement_month date,
  source_file    text,
  -- Stable hash of (date, amount, counterparty, source_file) so re-running
  -- the export is idempotent — an unchanged deposit upserts onto itself.
  dedupe_key     text not null unique,
  created_at     timestamptz not null default now()
);

create index income_deposits_date_idx  on income_deposits (txn_date);
create index income_deposits_group_idx on income_deposits (income_group);

comment on table income_deposits is
  'Classified bank deposits (deposits only) mirrored from the local UOB analyser. Parents-only. Feeds Finance → Income sources.';

-- ----------------------------------------------------------------------------
-- RLS — parents only
-- ----------------------------------------------------------------------------

alter table income_deposits enable row level security;

create policy "Parents manage income_deposits"
  on income_deposits for all
  to authenticated
  using (public.is_parent()) with check (public.is_parent());
