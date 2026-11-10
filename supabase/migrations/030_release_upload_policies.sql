-- ============================================================================
-- EVERYTINROOM POS — 030: PUBLISHING A BUILD ACTUALLY WORKS
--
-- Migration 025 gave the app-releases bucket an INSERT policy and an UPDATE
-- policy and stopped there. Publishing a build still failed, with:
--
--     new row violates row-level security policy
--
-- which reads like the upload was forbidden outright. It was not. The app
-- uploads with upsert enabled, so replacing version 2.1.0 overwrites the
-- object rather than erroring — and an upsert has to LOOK UP the existing row
-- before it can decide to replace it. There is no SELECT policy on
-- storage.objects for this bucket, so that lookup returned nothing the caller
-- was allowed to see and the write was refused.
--
-- The bucket is public, so its contents are already world-readable over the
-- public URL; the missing policy was never protecting anything, it was only
-- stopping the shop from publishing its own installer.
--
-- Proven rather than reasoned about: the same 1 MB upload to this bucket
-- returns 200 without the x-upsert header and 403 with it.
-- ============================================================================

-- Read. Required for upsert, and consistent with a bucket whose whole purpose
-- is handing the installer to anyone setting up a till.
DROP POLICY IF EXISTS "releases_read_objects" ON storage.objects;
CREATE POLICY "releases_read_objects" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'app-releases');

-- Replace. An UPDATE policy with no WITH CHECK cannot express "and the row you
-- leave behind must still belong to this bucket", so state both halves.
DROP POLICY IF EXISTS "releases_replace" ON storage.objects;
CREATE POLICY "releases_replace" ON storage.objects
  FOR UPDATE TO anon, authenticated
  USING (bucket_id = 'app-releases')
  WITH CHECK (bucket_id = 'app-releases');

-- Remove. Superseded installers are ~80 MB each and there was no way to clear
-- one out, so the bucket could only ever grow.
DROP POLICY IF EXISTS "releases_delete" ON storage.objects;
CREATE POLICY "releases_delete" ON storage.objects
  FOR DELETE TO anon, authenticated
  USING (bucket_id = 'app-releases');

-- Worth being explicit about what is and is not protected here: the upload is
-- not the security boundary and never was. publish_release is — it is gated on
-- an admin session token, and until it records a row no till will offer the
-- file. A stray object in this bucket is invisible to the app.
