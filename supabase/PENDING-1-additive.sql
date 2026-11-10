-- ==========================================================================
-- RUN THIS FIRST — EVERYTHING HERE IS ADDITIVE
-- ==========================================================================
--
-- Generated 2026-11-06 19:26 against
-- https://noiiuwkovoojkcwzupye.supabase.co
--
-- These add columns with safe defaults and new functions. They revoke
-- nothing and change no existing row, so a deployed app that has not been
-- updated keeps working exactly as it does now.
--
-- Paste the whole file into the Supabase SQL editor and run it.
--
-- Contains, in order:
--   031_sales_read_through_session.sql
--   033_promo_channels_and_server_pricing.sql


-- ------------------------------------------------------------------------
-- 031_sales_read_through_session.sql
-- ------------------------------------------------------------------------
-- ============================================================================
-- EVERYTINROOM POS — 031: READING THE BOOKS NEEDS A SESSION
--
-- `sales_select` has been `FOR SELECT TO anon USING (true)` since migration
-- 004. The anon key it answers to is compiled into the browser bundle, so this
-- was never "a cashier can see too much" — it was the shop's entire sales
-- ledger, readable by anyone who opened devtools on the storefront and copied
-- the key: every transaction, every total, every customer name, for all time.
--
-- 019 and 021 took the margins out of reach (profit moved server-side,
-- costPrice stripped from historical receipt lines), which is why this is the
-- last of the first audit's findings rather than the first. It is still the
-- whole ledger.
--
-- The till cannot simply be given a scoped RLS policy: sign-in is a PIN that
-- issues a row in `staff_sessions`, not Supabase Auth, so Postgres sees the
-- `anon` role for every cashier and `auth.uid()` is meaningless. RLS cannot
-- tell one cashier from another here. Reads therefore go the same way every
-- other privileged operation already goes — a SECURITY DEFINER function that
-- takes the session token.
--
-- THIS MIGRATION IS ADDITIVE. It only adds functions; nothing is taken away
-- and nothing breaks if the frontend has not been deployed yet. Migration 032
-- is the one that closes the table, and it must not be run until the frontend
-- is deployed and these functions are answering.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- list_sales — the till's and the reports' read path.
--
-- No session, no rows: an expired or absent token returns nothing rather than
-- an error, so a till whose shift ended shows an empty list instead of a
-- failure a cashier cannot act on.
--
-- Profit and costPrice follow the same rule the frontend already applies in
-- canSeeCost(): admins and staff with `reports` or `inventory_view`. For
-- everyone else profit comes back 0 and costPrice is stripped from the items,
-- so the margin sheet is not reachable through the receipt lines.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION list_sales(p_token TEXT, p_limit INT DEFAULT 300)
RETURNS TABLE (
  id          TEXT,
  receipt_no  TEXT,
  date        TIMESTAMPTZ,
  items       JSONB,
  subtotal    NUMERIC,
  discount    NUMERIC,
  total       NUMERIC,
  profit      NUMERIC,
  payment     TEXT,
  split_cash  NUMERIC,
  split_momo  NUMERIC,
  customer    TEXT,
  type        TEXT,
  cashier     TEXT,
  voided      BOOLEAN
) AS $$
DECLARE
  me       staff;
  see_cost BOOLEAN;
BEGIN
  me := session_staff(p_token);
  IF me.id IS NULL THEN RETURN; END IF;

  see_cost := session_can(p_token, 'reports') OR session_can(p_token, 'inventory_view');

  RETURN QUERY
  SELECT
    s.id,
    s.receipt_no,
    s.date,
    CASE WHEN see_cost THEN s.items
         ELSE COALESCE((
           SELECT jsonb_agg(it - 'costPrice' ORDER BY ord)
             FROM jsonb_array_elements(s.items) WITH ORDINALITY AS t(it, ord)
         ), '[]'::jsonb)
    END,
    s.subtotal,
    s.discount,
    s.total,
    CASE WHEN see_cost THEN s.profit ELSE 0::numeric END,
    s.payment,
    s.split_cash,
    s.split_momo,
    s.customer,
    s.type,
    s.cashier,
    s.voided
  FROM sales s
  ORDER BY s.date DESC
  -- Bounded server-side: the limit is a client-supplied number and this is the
  -- shop's ledger, so a caller cannot ask for all of it in one go.
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 300), 1000));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION list_sales(text, int) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- find_sale_by_receipt — the refund desk looking up one receipt.
--
-- RefundsPage used to read the table directly to show the lines for selection.
-- It needs to reach a sale of any age, which is exactly what 032 closes, so it
-- gets its own gated lookup. Gated on `refunds`, the same permission
-- process_refund itself checks, so the lookup cannot be used as a way around
-- it to browse the ledger one receipt at a time.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION find_sale_by_receipt(p_token TEXT, p_receipt_no TEXT)
RETURNS JSONB AS $$
DECLARE
  s        sales;
  stripped JSONB;
BEGIN
  IF NOT session_can(p_token, 'refunds') THEN
    RETURN jsonb_build_object('success', false,
      'error', 'You do not have permission to process refunds');
  END IF;

  SELECT * INTO s FROM sales WHERE receipt_no = p_receipt_no;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sale not found');
  END IF;

  -- A refund needs the lines and what was paid, never the cost. process_refund
  -- recomputes stock and profit server-side from the products table.
  stripped := COALESCE((
    SELECT jsonb_agg(it - 'costPrice' ORDER BY ord)
      FROM jsonb_array_elements(s.items) WITH ORDINALITY AS t(it, ord)
  ), '[]'::jsonb);

  RETURN jsonb_build_object('success', true, 'sale', jsonb_build_object(
    'id',         s.id,
    'receipt_no', s.receipt_no,
    'date',       s.date,
    'items',      stripped,
    'subtotal',   s.subtotal,
    'discount',   s.discount,
    'total',      s.total,
    'payment',    s.payment,
    'customer',   s.customer,
    'type',       s.type,
    'cashier',    s.cashier,
    'voided',     s.voided
  ));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION find_sale_by_receipt(text, text) TO anon, authenticated;


-- ------------------------------------------------------------------------
-- 033_promo_channels_and_server_pricing.sql
-- ------------------------------------------------------------------------
-- ============================================================================
-- EVERYTINROOM — 033: WHICH CHANNEL A PROMOTION BELONGS TO,
--                     AND WHO IS ALLOWED TO DECIDE A PRICE
--
-- Two problems, one migration, because they are the same problem: the browser
-- has been the authority on money.
--
-- 1. THERE IS NO SUCH THING AS A WEBSITE-ONLY PROMOTION TODAY.
--
--    The till and the storefront are not separate systems — they read the same
--    `promos` rows out of the same database. So a promotion created to shift
--    stock at the counter silently cuts the online price too, and a web
--    campaign quietly discounts the shop floor. There is no column that could
--    express the difference.
--
--    `channel` is that column. 'both' is the default, which is exactly what
--    every existing promotion already does, so nothing changes on deploy.
--
-- 2. THE CUSTOMER'S BROWSER SETS THE PRICE IT PAYS.
--
--    The storefront INSERTs its own order row with `total` computed in
--    JavaScript, then asks charge-momo to charge that same number. Neither the
--    table nor the edge function checks it against the catalogue. Migration
--    004 left `wa_insert WITH CHECK (true)` and `wa_update USING (true)`, and
--    the anon key is published in the bundle — so with nothing but devtools a
--    customer can order GHS 500 of goods for GHS 1, or skip paying altogether
--    by setting their own order's status to 'Paid'.
--
--    `place_web_order` ends that. It recomputes every line from `products` and
--    the promotions that actually apply to the web channel, totals it
--    server-side, and inserts the row itself. The browser sends product ids and
--    quantities; it never sends a price.
--
-- THIS MIGRATION IS ADDITIVE. It adds a column with a safe default and two
-- functions. It revokes nothing, so a deployed storefront that has not been
-- updated keeps working exactly as it does now. Migration 034 is the one that
-- closes the table, and it must not run until both apps are on the new path.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The channel column.
--
--    'both' preserves today's behaviour for every existing row. The CHECK
--    constraint is the point: a typo like 'online' must fail loudly at write
--    time rather than silently matching nothing and making a promotion vanish
--    from both channels.
-- ---------------------------------------------------------------------------
ALTER TABLE promos   ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'both';
ALTER TABLE bundles  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'both';

DO $$ BEGIN
  ALTER TABLE promos  ADD CONSTRAINT promos_channel_ck  CHECK (channel IN ('shop','web','both'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE bundles ADD CONSTRAINT bundles_channel_ck CHECK (channel IN ('shop','web','both'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN promos.channel IS
  'shop = the counter only, web = the website only, both = everywhere. Enforced in web_price()/place_web_order() server-side, not just hidden in the UI.';

-- ---------------------------------------------------------------------------
-- 2. The authoritative promotional price for one product on one channel.
--
--    One definition, used by the deals listing, the order placement and
--    anything added later, so the three cannot drift apart the way the till
--    and the storefront already have (each carries its own copy of this rule,
--    and they disagree about date handling).
--
--    Lowest wins when several promotions name the same product. That is the
--    rule the till already applies, it is predictable, and it always resolves
--    in the customer's favour — which is the only direction a pricing bug is
--    allowed to go.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION promo_price(p_product_id TEXT, p_channel TEXT)
RETURNS NUMERIC AS $$
  SELECT MIN((it->>'promoPrice')::numeric)
    FROM promos pr
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE jsonb_typeof(pr.items) WHEN 'array' THEN pr.items ELSE '[]'::jsonb END
    ) AS it
   WHERE pr.active
     AND pr.channel IN (p_channel, 'both')
     AND (pr.start_date IS NULL OR pr.start_date <= CURRENT_DATE)
     AND (pr.end_date   IS NULL OR pr.end_date   >= CURRENT_DATE)
     AND it->>'productId' = p_product_id
     AND (it->>'promoPrice') ~ '^[0-9]+(\.[0-9]+)?$'
     AND (it->>'promoPrice')::numeric > 0;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION promo_price(text, text) TO anon, authenticated;

-- The price a web shopper actually pays for one unit: the promotional price if
-- one applies to this channel, otherwise the shelf price.
CREATE OR REPLACE FUNCTION web_price(p_product_id TEXT)
RETURNS NUMERIC AS $$
  SELECT COALESCE(promo_price(p_product_id, 'web'), p.price, 0)
    FROM products p WHERE p.id = p_product_id;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION web_price(text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The deals catalogue, built from the products that already exist.
--
--    Nothing is duplicated: this returns the real product rows that currently
--    have a web-eligible promotion. A promotion starting tomorrow adds its
--    products tomorrow; one that expires drops out of the list by itself.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION web_deals()
RETURNS TABLE (
  id TEXT, name TEXT, category TEXT, image TEXT, quantity INT,
  price NUMERIC, promo_price NUMERIC, saving NUMERIC, saving_pct INT
) AS $$
  -- LATERAL so promo_price runs once per product rather than once per mention
  -- of it: the straightforward version evaluated it three times for each of
  -- 665 products, every time the deals page loaded.
  SELECT p.id, p.name, p.category, p.image, p.quantity,
         p.price,
         d.pp,
         p.price - d.pp,
         ROUND(((p.price - d.pp) / NULLIF(p.price, 0)) * 100)::int
    FROM products p
    CROSS JOIN LATERAL (SELECT promo_price(p.id, 'web') AS pp) d
   WHERE p.quantity > 0
     AND d.pp IS NOT NULL
     AND d.pp < p.price
   ORDER BY ((p.price - d.pp) / NULLIF(p.price, 0)) DESC;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION web_deals() TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Placing a web order, with the server deciding what it costs.
--
--    p_items is [{"productId":"...","qty":2}]. Any price, total or discount a
--    caller puts in there is ignored — the only fields read are the id and the
--    quantity.
--
--    Stock is checked but NOT deducted: the existing flow deducts when the
--    payment is confirmed, and changing that here would double-count. Overselling
--    between order and payment is handled where it already is.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION place_web_order(
  p_items          JSONB,
  p_customer_name  TEXT,
  p_customer_phone TEXT,
  p_address        TEXT DEFAULT NULL,
  p_notes          TEXT DEFAULT NULL,
  p_delivery_fee   NUMERIC DEFAULT 0
) RETURNS JSONB AS $$
DECLARE
  v_item     JSONB;
  v_prod     products;
  v_qty      INT;
  v_unit     NUMERIC;
  v_lines    JSONB := '[]'::jsonb;
  v_subtotal NUMERIC := 0;
  v_fee      NUMERIC;
  v_order_no TEXT;
  v_id       TEXT;
  v_ussd     INTEGER;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Your basket is empty');
  END IF;
  IF COALESCE(btrim(p_customer_phone), '') = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'A phone number is required');
  END IF;

  -- A caller-supplied delivery fee is clamped rather than trusted. Nothing in
  -- the shop delivers for a negative amount.
  v_fee := GREATEST(COALESCE(p_delivery_fee, 0), 0);

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := GREATEST(COALESCE((v_item->>'qty')::int, 0), 0);
    CONTINUE WHEN v_qty = 0;

    SELECT * INTO v_prod FROM products WHERE id = v_item->>'productId';
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false,
        'error', 'A product in your basket is no longer available');
    END IF;
    IF v_prod.quantity < v_qty THEN
      RETURN jsonb_build_object('success', false,
        'error', format('%s: only %s left', v_prod.name, v_prod.quantity));
    END IF;

    -- THE price. Not the one the browser suggested.
    v_unit := COALESCE(promo_price(v_prod.id, 'web'), v_prod.price, 0);
    IF v_unit <= 0 THEN
      RETURN jsonb_build_object('success', false,
        'error', format('%s is not priced for sale online', v_prod.name));
    END IF;

    v_subtotal := v_subtotal + (v_unit * v_qty);
    v_lines := v_lines || jsonb_build_object(
      'productId', v_prod.id, 'name', v_prod.name, 'qty', v_qty,
      'price', v_unit, 'lineTotal', v_unit * v_qty,
      'wasPrice', CASE WHEN v_unit < v_prod.price THEN v_prod.price ELSE NULL END
    );
  END LOOP;

  IF jsonb_array_length(v_lines) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Your basket is empty');
  END IF;

  v_order_no := 'ETR-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  -- The pay code comes from the counter in migration 016, not from the browser.
  -- The storefront was reading MAX(ussd_code) and adding one, which is the race
  -- 016 exists to close — two checkouts a moment apart can read the same
  -- maximum and both claim it, and 016's own comment says that already
  -- happened. If the function is missing, a NULL code is better than a
  -- duplicate one: nothing about the order is wrong, it just has no code yet.
  BEGIN
    v_ussd := next_ussd_code();
  EXCEPTION WHEN undefined_function THEN
    v_ussd := NULL;
  END;

  INSERT INTO whatsapp_orders (
    order_no, date, customer_name, customer_phone, items,
    subtotal, delivery_fee, total, address, notes, status, source, details_filled, ussd_code
  ) VALUES (
    v_order_no, now(), NULLIF(btrim(COALESCE(p_customer_name, '')), ''), btrim(p_customer_phone),
    v_lines, v_subtotal, v_fee, v_subtotal + v_fee,
    NULLIF(btrim(COALESCE(p_address, '')), ''), p_notes, 'Pending', 'web', true, v_ussd
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'success', true, 'orderId', v_id, 'orderNo', v_order_no, 'ussdCode', v_ussd,
    'subtotal', v_subtotal, 'deliveryFee', v_fee, 'total', v_subtotal + v_fee,
    'items', v_lines
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION place_web_order(jsonb, text, text, text, text, numeric) TO anon, authenticated;

