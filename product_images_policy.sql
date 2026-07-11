-- ============================================================
-- Allow the app to upload/read product images.
-- The browser uses the anon key, so the storage bucket needs
-- policies permitting insert (upload) and select (read).
-- Run in Supabase -> SQL Editor.
-- ============================================================

-- Make sure the bucket exists and is public (read).
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update set public = true;

-- Allow anyone (anon) to READ objects in product-images (public images).
drop policy if exists "product-images public read" on storage.objects;
create policy "product-images public read"
  on storage.objects for select
  using ( bucket_id = 'product-images' );

-- Allow uploads (insert) to product-images.
drop policy if exists "product-images upload" on storage.objects;
create policy "product-images upload"
  on storage.objects for insert
  with check ( bucket_id = 'product-images' );

-- Allow overwrite/update (upsert) to product-images.
drop policy if exists "product-images update" on storage.objects;
create policy "product-images update"
  on storage.objects for update
  using ( bucket_id = 'product-images' );

-- Allow delete in product-images (for replacing images).
drop policy if exists "product-images delete" on storage.objects;
create policy "product-images delete"
  on storage.objects for delete
  using ( bucket_id = 'product-images' );
