// ============================================================================
// RPC calls that survive whichever migrations have actually been applied.
//
// PostgREST resolves an RPC by its EXACT set of named arguments. Migration 020
// added `p_terminal` and `p_client_ref`; sending them to a database that has
// not run 020 does not ignore them — it fails resolution outright with
// PGRST202 and the sale never happens. That took cash sales down in
// production until this was added.
//
// So: try the full call, and if the server says it cannot find that function,
// drop the post-020 arguments and call the signature that is actually there.
// The till keeps selling either way; it just loses the terminal stamp and the
// duplicate-replay guard until the migration is run.
// ============================================================================

const POST_020 = ['p_terminal', 'p_client_ref']

// PGRST202 = "no function matches these arguments". Also catch the message
// shape in case the code is missing.
export function isMissingFunction(error) {
  if (!error) return false
  if (error.code === 'PGRST202') return true
  const m = String(error.message || '') + String(error.details || '')
  return /could not find the function|no matches were found in the schema cache/i.test(m)
}

function legacyArgs(args) {
  const out = { ...args }
  for (const k of POST_020) delete out[k]
  return out
}

// Returns supabase-js's { data, error }, plus `degraded: true` when it had to
// fall back, so the caller can tell the two paths apart.
export async function callRecordSale(sb, args) {
  const first = await sb.rpc('record_sale', args)
  if (!isMissingFunction(first.error)) return first

  console.warn('record_sale: pre-020 schema — retrying without terminal/client_ref. Run migration 020.')
  const second = await sb.rpc('record_sale', legacyArgs(args))
  return { ...second, degraded: true }
}

// ---------------------------------------------------------------------------
// Generic pre/post-migration fallback.
//
// Migrations 015-021 changed the signature of every privileged function to take
// a session token. Until they are run, calling the new signature fails
// resolution outright and the feature is simply dead — refunds, order packing,
// delivery and stock-take approvals. Rather than leave the shop unable to
// work, fall back to the signature that exists. The moment the migration
// lands, the first call succeeds and the server-side permission check takes
// over with no further change.
//
// `legacy` is only tried when the server says the function is MISSING, so a
// genuine "Not authorised" from a migrated database is never bypassed.
// ---------------------------------------------------------------------------
export async function rpcCompat(sb, fn, args, legacyArgs) {
  const first = await sb.rpc(fn, args)
  if (!isMissingFunction(first.error)) return first
  if (!legacyArgs) return first
  console.warn(`${fn}: pre-migration schema — using the legacy signature. Run migrations 015-021.`)
  const second = await sb.rpc(fn, legacyArgs)
  return { ...second, degraded: true }
}
