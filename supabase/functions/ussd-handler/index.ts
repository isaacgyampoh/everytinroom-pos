import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

serve(async (req) => {
  // Log EVERYTHING Nalo sends us
  const url = new URL(req.url)
  const method = req.method
  const headers: Record<string, string> = {}
  req.headers.forEach((v, k) => headers[k] = v)
  
  const queryParams: Record<string, string> = {}
  for (const [k, v] of url.searchParams) queryParams[k] = v

  let body = ''
  let bodyParsed: any = null
  
  if (method === 'POST' || method === 'PUT') {
    body = await req.text()
    try { bodyParsed = JSON.parse(body) } catch {}
  }

  console.log('=== NALO DEBUG ===')
  console.log('Method:', method)
  console.log('URL:', url.toString())
  console.log('Query params:', JSON.stringify(queryParams))
  console.log('Headers:', JSON.stringify(headers))
  console.log('Raw body:', body)
  console.log('Parsed body:', JSON.stringify(bodyParsed))
  console.log('=== END DEBUG ===')

  // Try ALL possible response formats to see which one Nalo accepts

  // Format 1: Nalo JSON with MSGTYPE
  const naloJson = { MSGTYPE: true, MSG: "Welcome to EVERYTINROOM. Enter order code:", USSDMSG: "Welcome to EVERYTINROOM. Enter order code:" }

  // Return JSON
  return new Response(JSON.stringify(naloJson), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })
})
