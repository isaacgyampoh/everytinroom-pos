-- ============================================================
-- BEDTIME BEDDINGS & HOME — WhatsApp AI Sales Agent schema
-- Safe to re-run. Drops any partial previous version first.
-- ============================================================

-- Clean up any partial previous attempt (safe if they don't exist).
DROP FUNCTION IF EXISTS wa_recent_messages(text, int);
DROP TABLE IF EXISTS wa_messages CASCADE;
DROP TABLE IF EXISTS wa_conversations CASCADE;
DROP TABLE IF EXISTS wa_agent_settings CASCADE;

-- One row per customer phone number = the agent's memory of a person.
CREATE TABLE wa_conversations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone         text UNIQUE NOT NULL,
  customer_name text DEFAULT '',
  summary       text DEFAULT '',
  stage         text DEFAULT 'chatting',
  last_order_no text DEFAULT '',
  agent_enabled boolean DEFAULT true,
  needs_human   boolean DEFAULT false,
  flag_reason   text DEFAULT '',
  last_message_at timestamptz DEFAULT now(),
  last_agent_at   timestamptz,
  followed_up   boolean DEFAULT false,
  created_at    timestamptz DEFAULT now()
);
CREATE INDEX idx_wa_conv_phone ON wa_conversations(phone);
CREATE INDEX idx_wa_conv_lastmsg ON wa_conversations(last_message_at);

-- Every message in/out.
CREATE TABLE wa_messages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone        text NOT NULL,
  role         text NOT NULL,
  content      text DEFAULT '',
  media_url    text DEFAULT '',
  wa_message_id text DEFAULT '',
  created_at   timestamptz DEFAULT now()
);
CREATE INDEX idx_wa_msg_phone ON wa_messages(phone, created_at);
CREATE UNIQUE INDEX idx_wa_msg_waid ON wa_messages(wa_message_id) WHERE wa_message_id <> '';

-- Agent settings.
CREATE TABLE wa_agent_settings (
  key   text PRIMARY KEY,
  value text
);
INSERT INTO wa_agent_settings (key, value) VALUES
  ('agent_master_enabled', 'true'),
  ('business_hours_only', 'false')
ON CONFLICT (key) DO NOTHING;

-- RLS.
ALTER TABLE wa_conversations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_messages        ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_agent_settings  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff read conversations" ON wa_conversations FOR SELECT USING (true);
CREATE POLICY "staff update conversations" ON wa_conversations FOR UPDATE USING (true);
CREATE POLICY "staff read messages" ON wa_messages FOR SELECT USING (true);
CREATE POLICY "staff read settings" ON wa_agent_settings FOR SELECT USING (true);
CREATE POLICY "staff update settings" ON wa_agent_settings FOR UPDATE USING (true);

-- Helper: last N messages for a phone.
CREATE OR REPLACE FUNCTION wa_recent_messages(p_phone text, p_limit int DEFAULT 20)
RETURNS TABLE(role text, content text, created_at timestamptz) AS $$
  SELECT m.role, m.content, m.created_at
  FROM wa_messages m
  WHERE m.phone = p_phone
  ORDER BY m.created_at DESC
  LIMIT p_limit;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ============================================================
-- EVERYTINROOM: ensure whatsapp_orders has the columns the AI
-- agent writes. Additive & safe — existing data untouched.
-- ============================================================
ALTER TABLE whatsapp_orders ADD COLUMN IF NOT EXISTS ussd_code integer;
ALTER TABLE whatsapp_orders ADD COLUMN IF NOT EXISTS source text DEFAULT '';
ALTER TABLE whatsapp_orders ADD COLUMN IF NOT EXISTS details_filled boolean DEFAULT false;
