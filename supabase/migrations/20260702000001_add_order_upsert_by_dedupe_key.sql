-- 既存orderのupsert処理（内示→確定の昇格・数量更新対応） (Issue #252)
-- Issue #249 で実装した create_order_skip_duplicate（重複時スキップのみ）を、
-- ステータス昇格・数量更新に対応した upsert_order_by_dedupe_key に置き換える。

-- ==========================================
-- orders: superseded_at カラム追加
-- ==========================================
-- deadline_date 変更を伴う内示の「引き継ぎ」は本Issueでは対応しないが、
-- 残存した古い forecast/forecast_tentative レコードが一覧に溜まり続けないよう、
-- superseded_at をセットして一覧表示から除外する運用上の最低限のケアを行う。
ALTER TABLE orders ADD COLUMN superseded_at timestamptz;

COMMENT ON COLUMN orders.superseded_at IS
  '内示の納期が前後した等の理由で後続のorderに引き継がれたレコードにセットされる。'
  'NULLでない場合は注文一覧から除外表示される（物理削除はしない）。';

-- ==========================================
-- create_order_skip_duplicate を削除し、upsert_order_by_dedupe_key を新設
-- ==========================================
-- 唯一の呼び出し元 backend/app/services/pdf_order_parsing_service.py の
-- _process_line_item のみで使用されていることを確認済み（Issue #252）。
DROP FUNCTION IF EXISTS create_order_skip_duplicate(
  uuid, bigint, bigint, int, date, text, text, text, text
);

CREATE OR REPLACE FUNCTION upsert_order_by_dedupe_key(
  p_tenant_id             uuid,
  p_customer_id           bigint,
  p_product_id            bigint,
  p_quantity              int,
  p_deadline_date         date,
  p_status                text,
  p_source_type           text,
  p_source_raw            text,
  p_extracted_product_name text
)
RETURNS TABLE (order_id bigint, action text)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_existing        orders%ROWTYPE;
  v_new_id          bigint;
  v_existing_priority int;
  v_new_priority      int;
BEGIN
  SELECT * INTO v_existing
  FROM orders
  WHERE tenant_id = p_tenant_id
    AND customer_id = p_customer_id
    AND product_id = p_product_id
    AND deadline_date = p_deadline_date
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO orders (
      tenant_id, customer_id, product_id, quantity, deadline_date,
      status, source_type, source_raw, extracted_product_name
    )
    VALUES (
      p_tenant_id, p_customer_id, p_product_id, p_quantity, p_deadline_date,
      p_status, p_source_type, p_source_raw, p_extracted_product_name
    )
    RETURNING orders.id INTO v_new_id;

    RETURN QUERY SELECT v_new_id, 'inserted'::text;
    RETURN;
  END IF;

  -- draft（手動下書き）は自動更新の対象外。常にコンフリクトとしてログのみ記録する。
  IF v_existing.status = 'draft' THEN
    RETURN QUERY SELECT v_existing.id, 'skipped_draft_conflict'::text;
    RETURN;
  END IF;

  -- ステータスの優先順位（数値が大きいほど確定度が高い）。
  -- 表にないステータス（canceled 等）は上書き対象外として扱う。
  v_existing_priority := CASE v_existing.status
    WHEN 'forecast_tentative' THEN 0
    WHEN 'forecast'           THEN 1
    WHEN 'confirmed'          THEN 2
    WHEN 'completed'          THEN 3
    ELSE NULL
  END;
  v_new_priority := CASE p_status
    WHEN 'forecast_tentative' THEN 0
    WHEN 'forecast'           THEN 1
    WHEN 'confirmed'          THEN 2
    WHEN 'completed'          THEN 3
    ELSE NULL
  END;

  IF v_existing_priority IS NULL
     OR v_new_priority IS NULL
     OR v_new_priority < v_existing_priority THEN
    RETURN QUERY SELECT v_existing.id, 'skipped_downgrade'::text;
    RETURN;
  END IF;

  IF v_new_priority = v_existing_priority AND v_existing.quantity = p_quantity THEN
    RETURN QUERY SELECT v_existing.id, 'skipped_no_change'::text;
    RETURN;
  END IF;

  UPDATE orders
  SET status                  = p_status,
      quantity                = p_quantity,
      source_type             = p_source_type,
      source_raw              = p_source_raw,
      extracted_product_name  = p_extracted_product_name
  WHERE id = v_existing.id;

  RETURN QUERY SELECT v_existing.id, 'updated'::text;
END;
$$;
