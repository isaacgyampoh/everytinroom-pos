import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const PAYSTACK_SECRET = 'sk_test_31dc1d98736dd0c3d10bd6a781b69b358297fd35'
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

    // ACTION 1: Initialize a mobile money charge
    if (action === 'charge') {
      const { phone, amount, email, reference } = await req.json()

      if (!phone || !amount) {
        return new Response(JSON.stringify({ success: false, error: 'Phone and amount required' }), { headers: CORS })
      }

      // Format phone: ensure it starts with 233 (Ghana)
      let formattedPhone = phone.replace(/\s+/g, '').replace(/^0/, '233').replace(/^\+/, '')
      if (!formattedPhone.startsWith('233')) formattedPhone = '233' + formattedPhone

      const ref = reference || 'ETR-MOMO-' + Date.now().toString(36).toUpperCase()
      const customerEmail = email || formattedPhone + '@everytinroom.shop'

      // Paystack charge with mobile_money
      const chargeRes = await fetch('https://api.paystack.co/charge', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + PAYSTACK_SECRET,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: customerEmail,
          amount: Math.round(amount * 100), // Paystack uses pesewas
          currency: 'GHS',
          mobile_money: {
            phone: formattedPhone,
            provider: 'mtn', // Will auto-detect provider
          },
          reference: ref,
          metadata: {
            source: 'everytinroom-pos',
            phone: phone,
          },
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

    // ACTION 2: Verify payment status
    if (action === 'verify') {
      const { reference } = await req.json()

      if (!reference) {
        return new Response(JSON.stringify({ success: false, error: 'Reference required' }), { headers: CORS })
      }

      const verifyRes = await fetch('https://api.paystack.co/transaction/verify/' + encodeURIComponent(reference), {
        headers: { 'Authorization': 'Bearer ' + PAYSTACK_SECRET },
      })

      const verifyData = await verifyRes.json()

      if (!verifyData.status) {
        return new Response(JSON.stringify({ success: false, error: verifyData.message || 'Verify failed', paymentStatus: 'unknown' }), { headers: CORS })
      }

      const txStatus = verifyData.data?.status // 'success', 'failed', 'pending', 'abandoned'

      return new Response(JSON.stringify({
        success: true,
        paymentStatus: txStatus,
        amount: (verifyData.data?.amount || 0) / 100, // Convert back from pesewas
        reference: verifyData.data?.reference,
        paidAt: verifyData.data?.paid_at,
      }), { headers: CORS })
    }

    // ACTION 3: Submit OTP (if required by Paystack)
    if (action === 'submit-otp') {
      const { reference, otp } = await req.json()

      const otpRes = await fetch('https://api.paystack.co/charge/submit_otp', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + PAYSTACK_SECRET,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reference, otp }),
      })

      const otpData = await otpRes.json()

      return new Response(JSON.stringify({
        success: otpData.status,
        status: otpData.data?.status,
        message: otpData.data?.display_text || otpData.message,
      }), { headers: CORS })
    }

    return new Response(JSON.stringify({ error: 'Invalid action. Use ?action=charge, verify, or submit-otp' }), { headers: CORS })

  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: e.message }), { status: 500, headers: CORS })
  }
})
