-- ============================================================
-- Add a product "group" so colour/type variants of the same product
-- share wholesale pricing. Run once in Supabase -> SQL Editor.
-- ============================================================

alter table public.products
  add column if not exists group_tag text;

-- (Optional) index for faster grouping if you have many products.
create index if not exists products_group_tag_idx on public.products (group_tag);

-- How to use:
--  Give every colour/type of the same product the SAME group_tag.
--  e.g. all "Two-in-One Sunblock Curtains" colours -> group_tag = 'sunblock-curtains'
--  Leave group_tag empty for products that have no variants (they behave as before).
