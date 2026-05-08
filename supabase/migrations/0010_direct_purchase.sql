-- Stocks: record_direct_purchase RPC
-- ===================================
-- For purchases that aren't tied to a bead period or a single
-- earmarked gift — typically when entering historical buys, or when
-- a parent funds a purchase from their own money and wants to split
-- shares directly across kids without going through pending deposits.

create or replace function public.record_direct_purchase(
  p_total_shares         numeric,
  p_price_per_share_usd  numeric,
  p_usd_to_sgd_rate      numeric,
  p_transaction_date     date,
  p_allocations          jsonb,    -- [{ member_id: uuid, shares: numeric }, ...]
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
  v_alloc_total  numeric;
begin
  if not public.is_parent() then
    raise exception 'Only parents can record stock purchases';
  end if;
  v_caller_id := public.current_member_id();

  if p_total_shares <= 0 then raise exception 'total_shares must be positive'; end if;
  if p_price_per_share_usd <= 0 then raise exception 'price_per_share_usd must be positive'; end if;
  if p_usd_to_sgd_rate <= 0 then raise exception 'usd_to_sgd_rate must be positive'; end if;
  if p_allocations is null or jsonb_array_length(p_allocations) = 0 then
    raise exception 'At least one allocation is required';
  end if;

  -- Sum the allocation shares and verify they match the total.
  select coalesce(sum((value->>'shares')::numeric), 0)
    into v_alloc_total
    from jsonb_array_elements(p_allocations) as t(value);

  -- Round-trip tolerance: 0.000001 shares = a millionth, well within
  -- the engine's six-decimal precision.
  if abs(v_alloc_total - p_total_shares) > 0.000001 then
    raise exception 'Allocation shares (%) must sum to total shares (%)',
      v_alloc_total, p_total_shares;
  end if;

  insert into stock_transactions (
    transaction_type, transaction_date, total_shares,
    price_per_share_usd, usd_to_sgd_rate, notes, created_by
  )
  values (
    'gift_purchase', p_transaction_date, p_total_shares,
    p_price_per_share_usd, p_usd_to_sgd_rate, p_notes, v_caller_id
  )
  returning id into v_tx_id;

  insert into stock_allocations (
    transaction_id, member_id, shares, cost_sgd, cost_usd, source_type
  )
  select
    v_tx_id,
    (a->>'member_id')::uuid,
    (a->>'shares')::numeric,
    round(((a->>'shares')::numeric * p_price_per_share_usd * p_usd_to_sgd_rate)::numeric, 2),
    round(((a->>'shares')::numeric * p_price_per_share_usd)::numeric, 4),
    'pending_deposit'::stock_allocation_source  -- nearest existing source enum value
  from jsonb_array_elements(p_allocations) as a
  where (a->>'shares')::numeric > 0;

  insert into notification_outbox (event_type, member_id, payload)
  select 'stock_purchase_recorded'::notification_event_type, fm.id,
         jsonb_build_object(
           'transaction_id',   v_tx_id,
           'transaction_type', 'direct_purchase',
           'total_shares',     p_total_shares,
           'total_sgd',        round((p_total_shares * p_price_per_share_usd * p_usd_to_sgd_rate)::numeric, 2)
         )
    from family_members fm
   where fm.role = 'parent' and fm.active = true;

  return v_tx_id;
end;
$$;

grant execute on function public.record_direct_purchase(numeric, numeric, numeric, date, jsonb, text) to authenticated;
