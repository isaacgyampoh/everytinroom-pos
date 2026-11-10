-- ============================================================
-- Order source tagging: distinguish Website / WhatsApp / Walk-in.
-- Run once in Supabase -> SQL Editor.
-- ============================================================

-- Source of the order: 'web' | 'whatsapp' | 'walkin'
alter table public.whatsapp_orders
  add column if not exists source text;

-- Whether the WhatsApp customer has submitted their delivery details yet.
alter table public.whatsapp_orders
  add column if not exists details_filled boolean default false;

-- (The 'address' column already exists and is used by website orders.)

-- Backfill existing rows from their order_no prefix so old orders show a source:
update public.whatsapp_orders
  set source = case
    when order_no like 'WEB-%' then 'web'
    when order_no like 'WA-%'  then 'whatsapp'
    when order_no like 'POS-%' then 'walkin'
    else source
  end
where source is null;

-- Index for filtering by source on the portal.
create index if not exists whatsapp_orders_source_idx on public.whatsapp_orders (source);
