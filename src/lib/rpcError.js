// Turns a Postgres "function does not exist" into something a shopkeeper can
// act on. The privileged RPCs changed signature in migration 018; if the app is
// deployed before the SQL is run, the raw error is
// `Could not find the function public.process_refund(...)`, which tells the
// person at the counter nothing.
export function rpcMessage(error, data, fallback = 'Something went wrong') {
  const raw = data?.error || error?.message || ''
  if (/could not find the function|does not exist|schema cache/i.test(raw)) {
    return 'This needs a database update — run migrations 015 to 020, then try again.'
  }
  return raw || fallback
}
