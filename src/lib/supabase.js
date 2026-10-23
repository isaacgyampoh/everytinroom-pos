import { createClient } from '@supabase/supabase-js'

// ============================================================================
// WHICH BACKEND THIS BUILD TALKS TO
//
// The project URL and anon key used to be written in here as literals, and the
// edge-function URL was then re-typed in full in nine other files. That made
// the backend un-switchable: standing the site up on a different Vercel
// account, or pointing a staging build at a staging project, meant editing
// sixteen string literals and hoping none were missed.
//
// They come from the build environment now. The live project stays as the
// fallback, so a deployment that sets nothing behaves exactly as it did.
//
// Vite inlines import.meta.env AT BUILD TIME. These are not read at runtime —
// set them in the Vercel project's environment variables and redeploy, or the
// build keeps whatever it was compiled with.
// ============================================================================

const FALLBACK_URL = 'https://noiiuwkovoojkcwzupye.supabase.co'
const FALLBACK_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5vaWl1d2tvdm9vamtjd3p1cHllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzExOTQyMTcsImV4cCI6MjA4Njc3MDIxN30.Wpduc4qYawgVSWqMqKPaDWUXm0dp8A_z9IxOrVfqN7w'

// Trailing slashes are stripped so every builder below can concatenate freely.
export const SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL || FALLBACK_URL).replace(/\/+$/, '')
export const SUPABASE_ANON_KEY = String(import.meta.env.VITE_SUPABASE_ANON_KEY || FALLBACK_ANON_KEY)

// An edge function endpoint. `fnUrl('charge-momo', 'reconcile-payments')`.
export function fnUrl(name, action) {
  const base = `${SUPABASE_URL}/functions/v1/${name}`
  return action ? `${base}?action=${action}` : base
}

// A public object in Supabase Storage.
export function storageUrl(bucket, path) {
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`
}

const supabaseInstance = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

export function getSupabase() {
  return supabaseInstance
}

export function isConfigured() {
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY)
}
