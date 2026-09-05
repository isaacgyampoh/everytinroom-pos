-- ============================================================================
-- EVERYTINROOM POS — 023: STOCK INTELLIGENCE
--
-- The shop is losing money at both ends and had no way to see either:
--
--   * GHS 217,039 of stock has not sold in 90 days — 40% of the GHS 542,081
--     on the shelves, sitting as cash that cannot be spent.
--   * 107 products are OUT OF STOCK while still selling. Nano tape moved 38
--     units in 90 days and is at zero; every day it stays there is revenue
--     walking out of the door.
--
-- Both are computable from data already recorded. This does it in one pass on
-- the server rather than shipping every sale to the browser — the till only
-- keeps the last 150 sales, so the client could never have seen 90 days.
-- ============================================================================

CREATE OR REPLACE FUNCTION stock_insights(p_days INT DEFAULT 90)
RETURNS TABLE (
  id             TEXT,
  name           TEXT,
  category       TEXT,
  price          NUMERIC,
  cost_price     NUMERIC,
  quantity       INT,
  sold           INT,
  revenue        NUMERIC,
  last_sold      TIMESTAMPTZ,
  per_week       NUMERIC,
  weeks_cover    NUMERIC,
  tied_up        NUMERIC
) AS $$
  WITH sold AS (
    SELECT (i->>'productId')                       AS pid,
           SUM(COALESCE((i->>'qty')::INT, 0))      AS qty,
           SUM(COALESCE((i->>'lineTotal')::NUMERIC, 0)) AS rev,
           MAX(s.date)                             AS last_sold
      FROM sales s, jsonb_array_elements(s.items) i
     WHERE NOT s.voided
       AND s.date > now() - make_interval(days => p_days)
       AND NULLIF(i->>'productId', '') IS NOT NULL
     GROUP BY 1
  )
  SELECT p.id, p.name, p.category, p.price, p.cost_price, p.quantity,
         COALESCE(s.qty, 0)::INT                                   AS sold,
         COALESCE(s.rev, 0)                                        AS revenue,
         s.last_sold,
         -- units a week, over the window actually requested
         ROUND(COALESCE(s.qty, 0)::NUMERIC / GREATEST(p_days / 7.0, 1), 2) AS per_week,
         -- how long the shelf lasts at that rate; NULL when nothing is moving
         CASE WHEN COALESCE(s.qty, 0) = 0 THEN NULL
              ELSE ROUND(p.quantity / NULLIF(COALESCE(s.qty, 0)::NUMERIC / GREATEST(p_days / 7.0, 1), 0), 1)
         END                                                       AS weeks_cover,
         -- cash sitting on the shelf, at cost where known, else at price
         ROUND(p.quantity * COALESCE(NULLIF(p.cost_price, 0), p.price), 2) AS tied_up
    FROM products p
    LEFT JOIN sold s ON s.pid = p.id;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions;

GRANT EXECUTE ON FUNCTION stock_insights(int) TO anon, authenticated;

-- The join above walks every sale in the window; without this it is a full
-- scan of the items JSON on each call.
CREATE INDEX IF NOT EXISTS idx_sales_date_live ON sales (date DESC) WHERE NOT voided;

-- ---------------------------------------------------------------------------
-- Bulk catalogue repair. 445 products carry no cost price, which is what makes
-- every profit figure fiction, and none carry a barcode, which is why the
-- scanner finds nothing. Editing them one modal at a time is not realistic, so
-- the app saves a screenful at once — gated on `product_management` the same
-- way the Products page is.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION bulk_update_products(p_token TEXT, p_rows JSONB)
RETURNS JSON AS $$
DECLARE r JSONB; n INT := 0; clash TEXT;
BEGIN
  IF NOT session_can(p_token, 'product_management') THEN
    RETURN json_build_object('success', false, 'error', 'You do not have permission to edit products');
  END IF;
  IF p_rows IS NULL OR jsonb_array_length(p_rows) = 0 THEN
    RETURN json_build_object('success', true, 'updated', 0);
  END IF;

  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    -- A barcode identifies exactly one product; refuse the whole save rather
    -- than leave two products fighting over the same scan.
    IF NULLIF(r->>'barcode', '') IS NOT NULL THEN
      SELECT name INTO clash FROM products
       WHERE barcode = r->>'barcode' AND id <> r->>'id' LIMIT 1;
      IF clash IS NOT NULL THEN
        RETURN json_build_object('success', false,
          'error', format('Barcode %s already belongs to "%s"', r->>'barcode', clash));
      END IF;
    END IF;

    UPDATE products SET
      cost_price = COALESCE((r->>'cost_price')::NUMERIC, cost_price),
      price      = COALESCE((r->>'price')::NUMERIC, price),
      barcode    = COALESCE(NULLIF(r->>'barcode', ''), barcode)
    WHERE id = r->>'id';
    IF FOUND THEN n := n + 1; END IF;
  END LOOP;

  RETURN json_build_object('success', true, 'updated', n);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;

GRANT EXECUTE ON FUNCTION bulk_update_products(text, jsonb) TO anon, authenticated;
