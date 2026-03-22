-- ============================================
-- SETUP: AI Product Scanner Edge Function
-- ============================================

-- STEP 1: Add OpenAI key to Supabase
-- Go to Supabase Dashboard → your project
-- Settings → Edge Functions → Add New Secret
-- Name: OPENAI_API_KEY
-- Value: sk-proj-your-key-here
--
-- OR use CLI:
-- supabase secrets set OPENAI_API_KEY=sk-proj-your-key-here

-- STEP 2: Deploy the edge function
-- supabase functions deploy scan-product

-- Uses GPT-4o-mini with vision (~1 pesewa per scan)
