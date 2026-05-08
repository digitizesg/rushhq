-- Beads simplification: drop categories.
-- Charts are now a flat ordered list of items per child. The bead
-- colours stay (those are the SGD-mapping reference data), but the
-- category grouping is gone — Ben asked for a simpler list-only UI.

-- 1. Replace clone_bead_chart so it no longer copies category_id.
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

  return v_new_chart_id;
end;
$$;

-- 2. Drop the category_id column from items. Existing rows lose the
--    grouping they had (which we don't surface anywhere now).
alter table bead_chart_items drop column if exists category_id;

-- 3. Drop the categories table itself. CASCADE removes any leftover
--    FKs / policies.
drop table if exists public.bead_categories cascade;
