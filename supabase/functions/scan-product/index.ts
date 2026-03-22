import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const OPENAI_KEY = Deno.env.get('OPENAI_API_KEY') || ''
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { imageData, productList } = await req.json()

    if (!imageData || !productList) {
      return new Response(JSON.stringify({ error: 'Missing image or product list' }), { headers: CORS, status: 400 })
    }

    if (!OPENAI_KEY) {
      return new Response(JSON.stringify({ error: 'API key not configured' }), { headers: CORS, status: 500 })
    }

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageData}`, detail: 'low' } },
            { type: 'text', text: `You are a product scanner for a store called EVERYTINROOM. Look at this image carefully.

First, read ANY text visible in the image - product labels, tags, stickers, handwriting, printed names, price tags, packaging text.

Then match what you see (text OR the product itself) to these store products: ${productList}

Return ONLY a JSON array of 1-3 matching product names EXACTLY as listed above. If no match, return [].` }
          ]
        }]
      })
    })

    const data = await res.json()

    if (!res.ok) {
      return new Response(JSON.stringify({ error: data.error?.message || 'AI API error' }), { headers: CORS, status: 500 })
    }

    const text = (data.choices?.[0]?.message?.content || '[]').replace(/```json|```/g, '').trim()
    return new Response(JSON.stringify({ matches: text }), { headers: CORS })

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message || 'Server error' }), { headers: CORS, status: 500 })
  }
})
