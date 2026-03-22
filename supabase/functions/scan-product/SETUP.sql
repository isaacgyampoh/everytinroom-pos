-- ============================================
-- SETUP: AI Product Scanner Edge Function
-- ============================================

-- STEP 1: Get an Anthropic API Key
-- Go to: https://console.anthropic.com
-- Create account or sign in
-- Go to API Keys → Create new key
-- Copy the key (starts with sk-ant-)

-- STEP 2: Add the key to Supabase
-- Go to Supabase Dashboard → Settings → Edge Functions
-- Or use the CLI:
-- supabase secrets set ANTHROPIC_API_KEY=sk-ant-your-key-here

-- STEP 3: Deploy the edge function
-- In terminal, from the project folder:
-- supabase functions deploy scan-product

-- That's it! The camera scanner on POS will now work.

-- COST: Claude Sonnet costs about $0.003 per scan (~2 pesewas)
-- Very affordable even if you scan 100 products a day
