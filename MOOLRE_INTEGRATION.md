# Moolre Payment Integration — Reference & Plan
*(Prepared from docs.moolre.com — for the EVERYTINROOM POS migration off NaloPay)*

## Environments
- **Live:** `https://api.moolre.com`
- **Sandbox:** `https://sandbox.moolre.com`  ← test here first; no API key needed, only `X-API-USER`

## Credentials needed from Moolre (get these tomorrow)
- `X-API-USER` — your Moolre username
- `X-API-KEY` — Private API Key (for initiating payments/transfers)
- `X-API-PUBKEY` — Public API Key (for status checks, payment links)
- **Account Number** — your Moolre wallet number (e.g. 100000xxxxxx) — required in every request body
- Confirm: does your account require **OTP** on payments (code TP14), or direct prompt?

---

## THE KEY ENDPOINT — Initiate Payment (instant prompt to customer)
This is the replacement for NaloPay's collection / the instant-prompt fix.

**POST** `https://api.moolre.com/open/transact/payment`

Headers:
```
X-API-USER: <username>
X-API-KEY:  <private key>
Content-Type: application/json
```
Body:
```json
{
  "type": 1,
  "channel": "13",            // 13=MTN, 6=Telecel, 7=AT   (NOTE: MTN=13 for payments)
  "currency": "GHS",
  "payer": "0246798090",      // customer's phone
  "amount": "25.00",
  "externalref": "POS-<unique>",   // must be unique per attempt
  "reference": "Order POS-1234",
  "accountnumber": "<your moolre account no>"
}
```
Responses:
- Success (prompt sent): `{ "status":1, "code":"TR099", "data":"<moolre-uuid>" }`
- OTP required:          `{ "status":1, "code":"TP14", "message":"complete verification via SMS..." }`
- Duplicate ref:         `{ "status":"0", "code":"TP13", ... }`

## Confirm payment — Webhook (preferred)
Set `callback` on your account (Update Account) to your edge function URL.
Moolre POSTs to it when payment completes:
```json
{ "status":1, "code":"P01", "message":"Transaction Successful", "data": { ...txn details... } }
```

## Confirm payment — Status poll (fallback)
**POST** `https://api.moolre.com/open/transact/status`
Headers: `X-API-USER` + `X-API-PUBKEY`
Body:
```json
{ "type":1, "idtype":"1", "id":"<your externalref>", "accountnumber":"<acct>" }
```
`data.txstatus`: 1 = success, 0 = pending, 2 = failed

## Validate name (optional, nice UX) — confirm MoMo holder before charging
**POST** `https://api.moolre.com/open/transact/validate`
Body: `{ type:1, receiver:"<phone>", channel:"1", currency:"GHS", accountnumber:"<acct>" }`
(channel here: 1=MTN, 6=Telecel, 7=AT, 2=Bank)
→ returns the registered name. Good to show the cashier "BRIGHT BUAME" before sending the prompt.

## SMS (could replace mNotify too, optional)
**POST** `https://api.moolre.com/open/sms/send` (needs `X-API-VASKEY`)
Moolre also does SMS — could consolidate, but keep mNotify for now to avoid scope creep.

---

## Migration plan (do tomorrow, in this order)
1. **Sandbox first.** Point a COPY of the edge function at `sandbox.moolre.com`, test Initiate Payment + status with `X-API-USER` only.
2. Build a new isolated action in the edge function, e.g. `?action=moolre-charge` and `?action=moolre-callback` — DO NOT delete the NaloPay code yet; run them side by side.
3. Map fields: payer=customer phone, amount=order total, externalref=order_no (must be unique), channel by network (13/6/7).
4. On webhook P01 success → mark order Paid + send the existing confirmation SMS (reuse current sendSMS).
5. Test end-to-end in sandbox with a real-ish flow.
6. Switch the POS USSD/checkout path to call moolre-charge instead of nalopayCharge.
7. Get live keys, set them as Supabase secrets, flip base URL to api.moolre.com.
8. Only after live test passes: retire the NaloPay path.

## Open questions to settle before building
- Keep the dial-a-code USSD (`*920*141*code#`) model, or switch to Moolre's direct push prompt? (Direct push is simpler and likely fixes the "no instant prompt" problem.)
- Does the account need OTP (TP14) handling?
- Confirm the exact MoMo channel codes for YOUR account (docs show payments use 13 for MTN, but validate/transfer use 1 for MTN — worth confirming).

## HARD RULE
No changes to the live payment edge function until: (a) keys in hand,
(b) tested in sandbox, (c) explicit approval. NaloPay stays running until
Moolre is proven live.
