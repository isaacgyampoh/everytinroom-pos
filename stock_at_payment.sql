-- ============================================================
-- Deduct stock at PAYMENT (not packaging) + restore on cancel.
-- Idempotent: an order's stock is deducted at most once and
-- restored at most once. Run in Supabase -> SQL Editor.
-- ============================================================

-- 1. Flag so we never deduct/restore the same order twice.
alter table public.whatsapp_orders
  add column if not exists stock_deducted boolean default false;

-- 2. Deduct stock for an order's items — ONCE. Safe to call repeatedly.
create or replace function public.deduct_order_stock(p_order_id uuid)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_order   public.whatsapp_orders%rowtype;
  v_items   jsonb;
  v_item    jsonb;
  v_pid     uuid;
  v_qty     numeric;
  v_name    text;
begin
  select * into v_order from public.whatsapp_orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'order not found');
  end if;

  -- Already deducted -> do nothing (idempotent).
  if coalesce(v_order.stock_deducted, false) then
    return jsonb_build_object('success', true, 'note', 'already deducted');
  end if;

  -- items may be stored as jsonb or as a json string.
  begin
    if jsonb_typeof(v_order.items) is not null then
      v_items := v_order.items;
    else
      v_items := v_order.items::jsonb;
    end if;
  exception when others then
    v_items := (v_order.items #>> '{}')::jsonb;
  end;

  if v_items is null then
    update public.whatsapp_orders set stock_deducted = true where id = p_order_id;
    return jsonb_build_object('success', true, 'note', 'no items');
  end if;

  -- Loop items and decrement product stock. Match by product_id if present,
  -- else by name (website carts may store name only).
  for v_item in select * from jsonb_array_elements(v_items)
  loop
    v_qty  := coalesce((v_item->>'qty')::numeric, (v_item->>'quantity')::numeric, 1);
    v_pid  := null;
    begin v_pid := (v_item->>'productId')::uuid; exception when others then v_pid := null; end;
    v_name := coalesce(v_item->>'name', '');

    if v_pid is not null then
      update public.products
        set quantity = greatest(0, coalesce(quantity,0) - v_qty)
        where id = v_pid;
    elsif v_name <> '' then
      update public.products
        set quantity = greatest(0, coalesce(quantity,0) - v_qty)
        where lower(name) = lower(v_name);
    end if;
  end loop;

  update public.whatsapp_orders set stock_deducted = true where id = p_order_id;
  return jsonb_build_object('success', true, 'note', 'deducted');
end;
$$;

-- 3. Restore stock for an order (cancel/refund) — ONCE.
create or replace function public.restore_order_stock(p_order_id uuid)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_order public.whatsapp_orders%rowtype;
  v_items jsonb;
  v_item  jsonb;
  v_pid   uuid;
  v_qty   numeric;
  v_name  text;
begin
  select * into v_order from public.whatsapp_orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'order not found');
  end if;

  -- Only restore if it was actually deducted.
  if not coalesce(v_order.stock_deducted, false) then
    return jsonb_build_object('success', true, 'note', 'was not deducted');
  end if;

  begin
    if jsonb_typeof(v_order.items) is not null then v_items := v_order.items;
    else v_items := v_order.items::jsonb; end if;
  exception when others then v_items := (v_order.items #>> '{}')::jsonb; end;

  if v_items is not null then
    for v_item in select * from jsonb_array_elements(v_items)
    loop
      v_qty  := coalesce((v_item->>'qty')::numeric, (v_item->>'quantity')::numeric, 1);
      v_pid  := null;
      begin v_pid := (v_item->>'productId')::uuid; exception when others then v_pid := null; end;
      v_name := coalesce(v_item->>'name', '');
      if v_pid is not null then
        update public.products set quantity = coalesce(quantity,0) + v_qty where id = v_pid;
      elsif v_name <> '' then
        update public.products set quantity = coalesce(quantity,0) + v_qty where lower(name) = lower(v_name);
      end if;
    end loop;
  end if;

  update public.whatsapp_orders set stock_deducted = false where id = p_order_id;
  return jsonb_build_object('success', true, 'note', 'restored');
end;
$$;

-- 4. Backfill: mark orders that are already Paid/Completed as deducted so we
-- don't double-deduct them on the first reconcile after this migration.
-- (Their stock was already taken at packaging under the old flow.)
update public.whatsapp_orders
  set stock_deducted = true
  where status in ('Paid','Completed') and coalesce(stock_deducted,false) = false;
