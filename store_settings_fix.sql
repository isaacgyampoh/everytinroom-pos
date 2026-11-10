-- ============================================================
-- FIX / RE-RUN: store on/off switch
-- Safe to run again even if you ran it before. This guarantees the
-- table exists, the single row (id=1) exists, and the anon key (which
-- both the POS and the shop use) can READ and UPDATE it.
-- Run this whole thing in Supabase -> SQL Editor.
-- ============================================================

create table if not exists public.store_settings (
  id             int primary key default 1,
  shop_open      boolean not null default true,
  closed_message text not null default 'We are currently closed. Please check back soon.',
  updated_at     timestamptz not null default now()
);

-- Make sure the single row exists (id = 1).
insert into public.store_settings (id, shop_open)
values (1, true)
on conflict (id) do nothing;

-- If closed_message column was missing from an earlier run, add it.
alter table public.store_settings
  add column if not exists closed_message text not null default 'We are currently closed. Please check back soon.';

-- ---------- Permissions ----------
alter table public.store_settings enable row level security;

-- Grant the anon + authenticated roles table privileges (RLS still applies).
grant select, insert, update on public.store_settings to anon, authenticated;

-- Drop any old policies, then create open read + write policies.
drop policy if exists "store_settings read"   on public.store_settings;
drop policy if exists "store_settings update" on public.store_settings;
drop policy if exists "store_settings insert" on public.store_settings;

create policy "store_settings read"
  on public.store_settings for select
  to anon, authenticated
  using (true);

create policy "store_settings update"
  on public.store_settings for update
  to anon, authenticated
  using (true) with check (true);

create policy "store_settings insert"
  on public.store_settings for insert
  to anon, authenticated
  with check (true);

-- ---------- Realtime (so the shop flips without a refresh) ----------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'store_settings'
  ) then
    alter publication supabase_realtime add table public.store_settings;
  end if;
end $$;

-- ---------- Verify ----------
-- After running, this should return one row with shop_open = true.
select * from public.store_settings;
