-- ============================================
-- 009: WhatsApp AI Bot - Conversations Table
-- Run this in Supabase SQL Editor
-- ============================================

-- Store AI conversation history per customer
CREATE TABLE IF NOT EXISTS wa_conversations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  chat_id text UNIQUE NOT NULL,          -- e.g. 233241234567@s.whatsapp.net
  customer_name text DEFAULT 'Customer',
  messages jsonb DEFAULT '[]'::jsonb,     -- Array of {role, content}
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Index for fast lookup by chat_id
CREATE INDEX IF NOT EXISTS idx_wa_conv_chat ON wa_conversations(chat_id);

-- Auto-cleanup: delete conversations older than 30 days
-- (keeps database small, customers rarely continue chats after 30 days)
CREATE OR REPLACE FUNCTION cleanup_old_conversations()
RETURNS void AS $$
BEGIN
  DELETE FROM wa_conversations WHERE updated_at < now() - interval '30 days';
END;
$$ LANGUAGE plpgsql;
