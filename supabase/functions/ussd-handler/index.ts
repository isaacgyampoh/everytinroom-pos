import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

serve(async (req) => {
  // Log everything
  const url = new URL(req.url)
  const queryParams: Record<string, string> = {}
  for (const [k, v] of url.searchParams) queryParams[k] = v

  let body = ''
  try { body = await req.text() } catch {}

  console.log('METHOD:', req.method)
  console.log('QUERY:', JSON.stringify(queryParams))
  console.log('BODY:', body)
  console.log('CONTENT-TYPE:', req.headers.get('content-type'))

  // Try plain text response - just the message, nothing else
  return new Response("Welcome to EVERYTINROOM\n1. Continue\n2. Exit", {
    status: 200,
    headers: { 'Content-Type': 'text/plain' }
  })
})
