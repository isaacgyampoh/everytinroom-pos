import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const PAYSTACK_SECRET = Deno.env.get('PAYSTACK_SECRET_KEY') || ''
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const url = new URL(req.url)
    const action = url.searchParams.get('action')

    // ACTION 1: Initialize a transaction (works in test mode)
    if (action === 'initialize') {
      const { phone, amount, email, reference, callbackUrl } = await req.json()

      if (!phone || !amount) {
        return new Response(JSON.stringify({ success: false, error: 'Phone and amount required' }), { headers: CORS })
      }

      let formattedPhone = phone.replace(/\s+/g, '').replace(/^0/, '233').replace(/^\+/, '')
      if (!formattedPhone.startsWith('233')) formattedPhone = '233' + formattedPhone

      const ref = reference || 'ETR-MOMO-' + Date.now().toString(36).toUpperCase()
      const customerEmail = email || formattedPhone + '@everytinroom.shop'

      const initRes = await fetch('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + PAYSTACK_SECRET,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: customerEmail,
          amount: Math.round(amount * 100),
          currency: 'GHS',
          reference: ref,
          channels: ['mobile_money'],
          callback_url: callbackUrl || 'https://everytinroom-pos.vercel.app',
          metadata: {
            source: 'everytinroom-pos',
            phone: phone,
            custom_fields: [
              { display_name: 'Phone', variable_name: 'phone', value: phone }
            ]
          },
        }),
      })

      const initData = await initRes.json()

      if (!initData.status) {
        return new Response(JSON.stringify({ success: false, error: initData.message || 'Init failed' }), { headers: CORS })
      }

      return new Response(JSON.stringify({
        success: true,
        authorizationUrl: initData.data?.authorization_url,
        accessCode: initData.data?.access_code,
        reference: initData.data?.reference || ref,
      }), { headers: CORS })
    }

    // ACTION 2: Charge with mobile money directly (for live mode)
    if (action === 'charge') {
      const { phone, amount, email, reference } = await req.json()

      if (!phone || !amount) {
        return new Response(JSON.stringify({ success: false, error: 'Phone and amount required' }), { headers: CORS })
      }

      let formattedPhone = phone.replace(/\s+/g, '').replace(/^0/, '233').replace(/^\+/, '')
      if (!formattedPhone.startsWith('233')) formattedPhone = '233' + formattedPhone

      const ref = reference || 'ETR-MOMO-' + Date.now().toString(36).toUpperCase()
      const customerEmail = email || formattedPhone + '@everytinroom.shop'

      const chargeRes = await fetch('https://api.paystack.co/charge', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + PAYSTACK_SECRET,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: customerEmail,
          amount: Math.round(amount * 100),
          currency: 'GHS',
          mobile_money: { phone: formattedPhone, provider: 'mtn' },
          reference: ref,
          metadata: { source: 'everytinroom-pos', phone: phone },
        }),
      })

      const chargeData = await chargeRes.json()

      if (!chargeData.status) {
        return new Response(JSON.stringify({ success: false, error: chargeData.message || 'Charge failed' }), { headers: CORS })
      }

      return new Response(JSON.stringify({
        success: true,
        reference: chargeData.data?.reference || ref,
        status: chargeData.data?.status,
        displayText: chargeData.data?.display_text || 'Check your phone for payment prompt',
      }), { headers: CORS })
    }

    // ACTION 3: Verify payment status
    if (action === 'verify') {
      const { reference } = await req.json()

      if (!reference) {
        return new Response(JSON.stringify({ success: false, error: 'Reference required' }), { headers: CORS })
      }

      const verifyRes = await fetch('https://api.paystack.co/transaction/verify/' + encodeURIComponent(reference), {
        headers: { 'Authorization': 'Bearer ' + PAYSTACK_SECRET },
      })

      const verifyData = await verifyRes.json()

      return new Response(JSON.stringify({
        success: verifyData.status || false,
        paymentStatus: verifyData.data?.status || 'unknown',
        amount: (verifyData.data?.amount || 0) / 100,
        reference: verifyData.data?.reference,
        paidAt: verifyData.data?.paid_at,
        message: verifyData.message,
      }), { headers: CORS })
    }

    return new Response(JSON.stringify({ error: 'Use ?action=initialize, charge, or verify' }), { headers: CORS })

  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: e.message }), { status: 500, headers: CORS })
  }
})
