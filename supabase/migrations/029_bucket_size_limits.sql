-- ============================================================================
-- EVERYTINROOM POS — 029: EVERY BUCKET STATES ITS OWN LIMIT
--
-- product-images and invoice-photos were created without a file_size_limit, so
-- they silently inherit whatever the PROJECT-WIDE storage limit happens to be.
-- That coupling is the problem: publishing the Windows installer needs the
-- project limit raised well past 50 MB, and the moment it goes up, both image
-- buckets quietly accept 150 MB uploads too — from anyone holding the anon key,
-- which is shipped in the public bundle by design.
--
-- A bucket should not change what it accepts because an unrelated bucket needed
-- room. Each one now states its own ceiling, so the project limit becomes a
-- roof rather than a default.
--
-- 25 MB is far above any phone photo (the shop's largest is under 6 MB) and far
-- below anything worth using as free file hosting.
-- ============================================================================

UPDATE storage.buckets SET file_size_limit = 25 * 1024 * 1024
 WHERE id IN ('product-images', 'invoice-photos');

-- The installer is ~80 MB and already had its own ceiling; restated so all
-- three buckets are declared in one place.
UPDATE storage.buckets SET file_size_limit = 400 * 1024 * 1024
 WHERE id = 'app-releases';

-- Note for whoever raises the project limit: buckets cap themselves now, but
-- the project limit still has to be >= the largest bucket that must work.
-- The installer needs it at 150 MB or more. See tools/publish_windows_build.sh.
