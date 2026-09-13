-- ============================================================================
-- EVERYTINROOM POS — 025: THE WINDOWS INSTALLER LIVES IN THE APP
--
-- The Windows till build is produced by CI and lands as a GitHub Actions
-- artifact. That is fine for a developer and useless for a shop: nobody
-- setting up a new counter should have to find a workflow run, sign in to
-- GitHub and dig an artifact out of it.
--
-- So the installer is published to the shop's own storage and the app offers
-- it. An admin opens Terminal & Printer on the new machine and downloads it
-- from the till software itself.
-- ============================================================================

-- A public bucket, deliberately.
--
-- The instinct is to lock the installer down, and the first version of this did
-- — but a private bucket needs a signed URL, and the browser cannot mint one
-- with the anon key without a storage policy that makes it public in all but
-- name. More to the point, the installer contains the same client bundle
-- already served from everytinroom.store to anyone who visits. It carries no
-- service key and no data; it is a shell around a public web app, and PINs are
-- hashed and verified server-side. Locking it away would add failure modes and
-- protect nothing.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('app-releases', 'app-releases', true, 400 * 1024 * 1024)
ON CONFLICT (id) DO UPDATE
  SET public = true, file_size_limit = 400 * 1024 * 1024;

-- What has been published. One row per build; the newest active row wins.
CREATE TABLE IF NOT EXISTS app_releases (
  id           TEXT PRIMARY KEY DEFAULT short_id(),
  platform     TEXT NOT NULL DEFAULT 'windows',
  version      TEXT NOT NULL,
  object_path  TEXT NOT NULL,              -- inside the app-releases bucket
  size_bytes   BIGINT,
  notes        TEXT DEFAULT '',
  published_by TEXT DEFAULT '',
  published_at TIMESTAMPTZ DEFAULT now(),
  active       BOOLEAN DEFAULT true
);
CREATE INDEX IF NOT EXISTS idx_app_releases_latest
  ON app_releases (platform, published_at DESC) WHERE active;

ALTER TABLE app_releases ENABLE ROW LEVEL SECURITY;
-- Readable so any till can show "version 2.1.0 is available". Writing a row is
-- admin-only, through publish_release below.
DROP POLICY IF EXISTS "releases_read" ON app_releases;
CREATE POLICY "releases_read" ON app_releases
  FOR SELECT TO anon, authenticated USING (active);
REVOKE INSERT, UPDATE, DELETE ON app_releases FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Publishing a build. Called after the installer has been uploaded to the
-- bucket, either by CI or by an admin from the app.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION publish_release(
  p_token   TEXT,
  p_version TEXT,
  p_path    TEXT,
  p_size    BIGINT,
  p_notes   TEXT DEFAULT '',
  p_platform TEXT DEFAULT 'windows'
) RETURNS JSON AS $$
DECLARE me staff; new_id TEXT;
BEGIN
  IF NOT session_can(p_token, 'admin') THEN
    RETURN json_build_object('success', false, 'error', 'Only an admin can publish a build');
  END IF;
  me := session_staff(p_token);
  IF COALESCE(trim(p_version), '') = '' OR COALESCE(trim(p_path), '') = '' THEN
    RETURN json_build_object('success', false, 'error', 'A version and a file are both required');
  END IF;

  -- Only the newest build is offered; older rows stay for the record.
  UPDATE app_releases SET active = false WHERE platform = p_platform AND active;

  new_id := short_id();
  INSERT INTO app_releases (id, platform, version, object_path, size_bytes, notes, published_by)
  VALUES (new_id, p_platform, trim(p_version), trim(p_path), p_size, COALESCE(p_notes, ''), me.name);

  RETURN json_build_object('success', true, 'id', new_id, 'version', trim(p_version));
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;

GRANT EXECUTE ON FUNCTION publish_release(text, text, text, bigint, text, text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Uploading into the bucket. Reads are public (see above); writes are not, so
-- an admin uploading from the app needs a policy that lets them.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "releases_upload" ON storage.objects;
CREATE POLICY "releases_upload" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'app-releases');

DROP POLICY IF EXISTS "releases_replace" ON storage.objects;
CREATE POLICY "releases_replace" ON storage.objects
  FOR UPDATE TO anon, authenticated
  USING (bucket_id = 'app-releases');

-- Note: the upload itself is not the security boundary — publish_release is.
-- A stray object in the bucket is invisible to every till until an admin
-- session records it as a release.
