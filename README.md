# EVERYTINROOM POS — React + Supabase + Vercel

Full React rewrite. No Google Sheets. No Google Apps Script.
Supabase database + Vercel hosting + mNotify SMS reports.

## Tech Stack
- **Frontend**: React 18 + Vite + Tailwind CSS + Zustand (state)
- **Database**: Supabase (PostgreSQL)
- **Backend**: Supabase Edge Functions + RPC functions
- **Hosting**: Vercel
- **SMS**: mNotify API via Edge Functions + pg_cron

---

##  SETUP (5 steps)

### 1. Supabase Database
- Go to Supabase Dashboard → **SQL Editor** → New Query
- Paste `supabase/migrations/001_schema.sql` → Run
- Copy your **Project URL** and **anon key** from Settings → API

### 2. SMS Cron Jobs
- Enable `pg_cron` and `pg_net` extensions (Database → Extensions)
- Edit `002_cron_jobs.sql` — replace `YOUR_SUPABASE_URL` and `YOUR_ANON_KEY`
- Paste into SQL Editor → Run

### 3. Deploy Edge Functions
```bash
npm i -g supabase
supabase login
supabase link --project-ref YOUR_REF
supabase functions deploy paystack-webhook --no-verify-jwt
supabase functions deploy sms-reports --no-verify-jwt
```
Set Paystack webhook to: `https://YOUR_REF.supabase.co/functions/v1/paystack-webhook`

### 4. Deploy to Vercel
```bash
npm i -g vercel
cd everytinroom-pos
npm install
vercel link          # pick the right account — .vercel/ may point at an old one
vercel --prod
```
Set the backend on the Vercel project (Settings → Environment Variables), for
Production, Preview and Development:

| Variable | Where it comes from |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase → Settings → API → anon key |

Both are optional — unset, the build falls back to the current live project.
They are inlined at build time, so a change needs a redeploy. See
[DEPLOYMENT.md](DEPLOYMENT.md), which also covers moving the site to a
different Vercel account and the domain handover.

### 5. First Login
- Open the deployment URL → the PIN pad appears; the app already knows its
  backend, so there is no credentials screen to fill in.
- Sign in with a staff PIN. PINs are stored hashed server-side
  (`010_secure_pins.sql`) and are set up in the Staff page, not in this file.

---

##  Structure
```
src/
├── App.jsx              # Main app + routing
├── components/          # Reusable UI
│   ├── CartDrawer.jsx   # Cart with checkout
│   ├── ErrorBoundary.jsx # Keeps a crash off the whole till
│   ├── Login.jsx        # PIN login
│   ├── Navigation.jsx   # Top/bottom/drawer nav
│   ├── Modal.jsx        # Reusable modal
│   ├── ReceiptPreview.jsx # Thermal receipt
│   └── Loader.jsx
├── hooks/
│   └── useStore.js      # Zustand global state
├── lib/
│   ├── supabase.js      # Supabase client + backend URL config
│   └── utils.js         # Helpers
├── pages/               # 12 page components
│   ├── Dashboard.jsx
│   ├── POS.jsx
│   ├── WhatsAppOrders.jsx
│   ├── Receipts.jsx
│   ├── Products.jsx
│   ├── BundlesPage.jsx
│   ├── StaffPage.jsx
│   ├── ExpensesPage.jsx
│   ├── CustomersPage.jsx
│   ├── PerformancePage.jsx
│   ├── RefundsPage.jsx
│   └── ReportsPage.jsx
supabase/
├── migrations/
│   ├── 001_schema.sql   # Full DB schema + RPC functions
│   └── 002_cron_jobs.sql
├── functions/
│   ├── paystack-webhook/ # Paystack → WA order creation
│   └── sms-reports/      # Automated SMS reports
```

---

## Features
-  POS with Retail/Wholesale/Bundle modes
-  WhatsApp orders with Paystack integration (realtime)
- Thermal receipt printing
-  Dashboard with live stats
- Staff performance tracking
- Refund processing with stock restoration
-  Expense tracking
-  Product bundles
-  Daily/weekly/monthly reports
-  SMS reports (mNotify) via pg_cron
-  PIN-based auth, hashed server-side
-  Realtime updates via Supabase WebSockets
-  Mobile-first responsive design
