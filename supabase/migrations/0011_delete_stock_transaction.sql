-- Stocks: delete_stock_transaction RPC
-- =====================================
-- Removes a stock transaction and all of its allocations, plus reverts
-- any side effects on the upstream bead module:
--   - bead_periods that were marked 'invested' against this transaction
--     return to 'counted' (so they can be re-included in a new buy)
--   - pending_deposits that were marked 'invested' against this
--     transaction return to 'pending'
--
-- Cost basis is computed from stock_allocations, so deletion correctly
-- removes the contribution to each child's holdings.

create or replace function public.delete_stock_transaction(p_tx_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_parent() then
    raise exception 'Only parents can delete stock transactions';
  end if;

  -- Revert bead_periods.
  update bead_periods
     set status                  = 'counted',
         invested_at             = null,
         invested_transaction_id = null
   where invested_transaction_id = p_tx_id;

  -- Revert pending_deposits.
  update pending_deposits
     set status                  = 'pending',
         invested_transaction_id = null
   where invested_transaction_id = p_tx_id;

  -- Delete the transaction. ON DELETE CASCADE on stock_allocations
  -- removes the per-child rows in the same statement.
  delete from stock_transactions where id = p_tx_id;

  if not found then
    raise exception 'Transaction % not found', p_tx_id;
  end if;
end;
$$;

grant execute on function public.delete_stock_transaction(uuid) to authenticated;
