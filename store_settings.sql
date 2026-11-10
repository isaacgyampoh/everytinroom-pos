-- ============================================================
-- Store on/off switch — shared between POS and erbliving.shop
-- Run this ONCE in Supabase (SQL Editor).
-- ============================================================

-- A single-row settings table. id is fixed to 1 so there's always one row.
create table if not exists public.store_settings (
  id           int primary key default 1,
  shop_open    boolean not null default true,
  closed_message text not null default 'We are currently closed. Please check back soon.',
  updated_at   timestamptz not null default now(),
  constraint store_settings_singleton check (id = 1)
);

-- Seed the single row (open by default). Safe to run repeatedly.
insert into public.store_settings (id, shop_open)
values (1, true)
on conflict (id) do nothing;

-- ---------- Row Level Security ----------
alter table public.store_settings enable row level security;

-- Anyone (the public shop, using the anon key) can READ the switch.
drop policy if exists "store_settings read" on public.store_settings;
create policy "store_settings read"
  on public.store_settings for select
  using (true);

-- Anyone with the anon key can UPDATE the switch.
-- (The POS already uses the anon key and is PIN-gated to admins in the app.)
-- If you later want this locked tighter, replace `true` with an auth check.
drop policy if exists "store_settings update" on public.store_settings;
create policy "store_settings update"
  on public.store_settings for update
  using (true)
  with check (true);

-- Optional: let Realtime broadcast changes so the shop flips instantly
-- without a refresh. (Safe to run; ignored if already added.)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'store_settings'
  ) then
    alter publication supabase_realtime add table public.store_settings;
  end if;
end $$;
