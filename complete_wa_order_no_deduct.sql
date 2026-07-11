-- ============================================================
-- Updated complete_wa_order: packaging no longer deducts stock.
-- Stock is now deducted at PAYMENT (deduct_order_stock). This
-- function still calculates profit and records the sale, but the
-- line that decremented product quantity has been REMOVED so stock
-- is never deducted twice.
-- Run in Supabase -> SQL Editor AFTER running stock_at_payment.sql.
-- ============================================================

CREATE OR REPLACE FUNCTION public.complete_wa_order(p_order_id text, p_processed_by text)
 RETURNS json
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_order RECORD;
  v_item JSONB;
  v_prod RECORD;
  v_profit NUMERIC := 0;
  v_sale_id TEXT;
  v_receipt TEXT;
BEGIN
  SELECT * INTO v_order FROM whatsapp_orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN json_build_object('success', false, 'error', 'Order not found'); END IF;
  IF v_order.status = 'Completed' THEN RETURN json_build_object('success', false, 'error', 'Already completed'); END IF;

  -- Calculate profit ONLY. Stock is NOT deducted here anymore — it was already
  -- deducted at payment (deduct_order_stock). Removing the UPDATE prevents
  -- double-deduction.
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_order.items) LOOP
    SELECT * INTO v_prod FROM products WHERE lower(name) = lower(v_item->>'name') LIMIT 1;
    IF FOUND THEN
      v_profit := v_profit + (
        COALESCE((v_item->>'price')::NUMERIC, 0) - v_prod.cost_price
      ) * COALESCE((v_item->>'qty')::INTEGER, 0);
    END IF;
  END LOOP;

  v_sale_id := short_id();
  v_receipt := generate_receipt_no();

  INSERT INTO sales (id, receipt_no, date, items, subtotal, discount, total, profit,
    payment, customer, type, cashier, voided)
  VALUES (v_sale_id, v_receipt, now(), v_order.items, v_order.subtotal, 0,
    v_order.total, v_profit, 'Paystack', v_order.customer_phone, 'WhatsApp',
    p_processed_by, false);

  -- Upsert customer
  IF v_order.customer_phone != '' THEN
    INSERT INTO customers (phone, visit_count, total_spent, last_visit)
    VALUES (v_order.customer_phone, 1, v_order.total, now())
    ON CONFLICT (phone) DO UPDATE SET
      visit_count = customers.visit_count + 1,
      total_spent = customers.total_spent + v_order.total,
      last_visit = now();
  END IF;

  UPDATE whatsapp_orders SET
    status = 'Completed', processed_by = p_processed_by, processed_at = now()
  WHERE id = p_order_id;

  RETURN json_build_object('success', true, 'receiptNo', v_receipt, 'saleId', v_sale_id);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$function$;
