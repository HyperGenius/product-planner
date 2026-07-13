-- 製品未マッチ明細のNULL product_id下書き起票 (Issue #296)
--
-- 既存の orders_dedupe_key = UNIQUE (tenant_id, customer_id, product_id, deadline_date) は
-- NULLの非等価性により product_id が NULL の行同士の重複を検出できない
-- （既知の制約として 20260702000000_add_order_status_forecast.sql にコメント済み）。
-- 製品マッチング失敗時に明細をドロップせず product_id=NULL で下書きを作成するよう
-- 挙動を変更するにあたり、product_id が NULL の行専用の部分UNIQUE制約を追加する。

-- ==========================================
-- product_id が NULL の行専用の部分UNIQUE制約
-- ==========================================
-- extracted_product_name または deadline_date が NULL の行は、意味のある重複判定が
-- できないため対象外とする（重複を許容する。Issue #296 未解決の問題として明記済み）。
CREATE UNIQUE INDEX orders_dedupe_key_unmatched_product
  ON orders (tenant_id, customer_id, deadline_date, extracted_product_name)
  WHERE product_id IS NULL
    AND deadline_date IS NOT NULL
    AND extracted_product_name IS NOT NULL;

-- ==========================================
-- upsert_order_by_dedupe_key: product_id IS NULL の分岐を追加
-- ==========================================
-- 既存行の特定方法のみ variant を分岐させ、その後の certainty priority hierarchy
-- （confirmed/completed/canceled保護 → manual draft保護 → certainty優先度判定）は
-- 既存ロジックをそのまま再利用する。
CREATE OR REPLACE FUNCTION upsert_order_by_dedupe_key(
  p_tenant_id              uuid,
  p_customer_id            bigint,
  p_product_id             bigint,
  p_quantity               int,
  p_deadline_date          date,
  p_customer_certainty     text,
  p_source_type            text,
  p_source_raw             text,
  p_extracted_product_name text,
  p_source_attachment_id   uuid DEFAULT NULL
)
RETURNS TABLE (order_id bigint, action text)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_existing          orders%ROWTYPE;
  v_new_id            bigint;
  v_existing_priority int;
  v_new_priority      int;
  v_extracted_name    text := NULLIF(TRIM(p_extracted_product_name), '');
BEGIN
  IF p_product_id IS NULL THEN
    IF v_extracted_name IS NULL OR p_deadline_date IS NULL THEN
      -- 重複判定に使える情報（品名・納期）が不足しているため、常に新規行として
      -- 挿入する（取りこぼしを許容する。Issue #296 未解決の問題として明記済み）。
      INSERT INTO orders (
        tenant_id, customer_id, product_id, quantity, deadline_date,
        status, customer_certainty, source_type, source_raw, extracted_product_name,
        source_attachment_id
      )
      VALUES (
        p_tenant_id, p_customer_id, NULL, p_quantity, p_deadline_date,
        'draft', p_customer_certainty, p_source_type, p_source_raw, v_extracted_name,
        p_source_attachment_id
      )
      RETURNING orders.id INTO v_new_id;

      RETURN QUERY SELECT v_new_id, 'inserted'::text;
      RETURN;
    END IF;

    INSERT INTO orders (
      tenant_id, customer_id, product_id, quantity, deadline_date,
      status, customer_certainty, source_type, source_raw, extracted_product_name,
      source_attachment_id
    )
    VALUES (
      p_tenant_id, p_customer_id, NULL, p_quantity, p_deadline_date,
      'draft', p_customer_certainty, p_source_type, p_source_raw, v_extracted_name,
      p_source_attachment_id
    )
    ON CONFLICT (tenant_id, customer_id, deadline_date, extracted_product_name)
      WHERE product_id IS NULL
        AND deadline_date IS NOT NULL
        AND extracted_product_name IS NOT NULL
      DO NOTHING
    RETURNING orders.id INTO v_new_id;

    IF v_new_id IS NOT NULL THEN
      RETURN QUERY SELECT v_new_id, 'inserted'::text;
      RETURN;
    END IF;

    SELECT * INTO v_existing
    FROM orders
    WHERE tenant_id = p_tenant_id
      AND customer_id = p_customer_id
      AND product_id IS NULL
      AND deadline_date = p_deadline_date
      AND extracted_product_name = v_extracted_name
    FOR UPDATE;
  ELSE
    -- 先にINSERTを試み、UNIQUE制約(orders_dedupe_key)の競合でしか
    -- 「既存あり」を判定しない。SELECTしてから未存在ならINSERTする順序だと、
    -- 同一dedupeキーへの並行呼び出しが両方SELECTでNOT FOUNDと判定してしまい、
    -- 片方が23505で例外終了する競合が起こり得るため。
    INSERT INTO orders (
      tenant_id, customer_id, product_id, quantity, deadline_date,
      status, customer_certainty, source_type, source_raw, extracted_product_name,
      source_attachment_id
    )
    VALUES (
      p_tenant_id, p_customer_id, p_product_id, p_quantity, p_deadline_date,
      'draft', p_customer_certainty, p_source_type, p_source_raw, v_extracted_name,
      p_source_attachment_id
    )
    ON CONFLICT ON CONSTRAINT orders_dedupe_key DO NOTHING
    RETURNING orders.id INTO v_new_id;

    IF v_new_id IS NOT NULL THEN
      RETURN QUERY SELECT v_new_id, 'inserted'::text;
      RETURN;
    END IF;

    SELECT * INTO v_existing
    FROM orders
    WHERE tenant_id = p_tenant_id
      AND customer_id = p_customer_id
      AND product_id = p_product_id
      AND deadline_date = p_deadline_date
    FOR UPDATE;
  END IF;

  -- confirmed/completed/canceled (ユーザーが確定・完了させた、またはキャンセルした注文)
  -- はPDF自動処理から完全に保護し、常にコンフリクトとしてログのみ記録する。
  IF v_existing.status IN ('confirmed', 'completed', 'canceled') THEN
    RETURN QUERY SELECT v_existing.id, 'skipped_downgrade'::text;
    RETURN;
  END IF;

  -- status='draft' かつ source_type='manual' (手動下書き) は自動更新の対象外。
  -- 常にコンフリクトとしてログのみ記録する。
  IF v_existing.status = 'draft' AND v_existing.source_type = 'manual' THEN
    RETURN QUERY SELECT v_existing.id, 'skipped_draft_conflict'::text;
    RETURN;
  END IF;

  -- ここから先は既存行が draft かつ source_type != 'manual'
  -- (メール/PDF起票の確認待ちdraft) のケース。
  -- customer_certainty の優先順位（数値が大きいほど確度が高い）で判定する。
  v_existing_priority := CASE v_existing.customer_certainty
    WHEN 'forecast_tentative' THEN 0
    WHEN 'forecast'           THEN 1
    WHEN 'confirmed'          THEN 2
    ELSE -1
  END;
  v_new_priority := CASE p_customer_certainty
    WHEN 'forecast_tentative' THEN 0
    WHEN 'forecast'           THEN 1
    WHEN 'confirmed'          THEN 2
    ELSE NULL
  END;

  IF v_new_priority IS NULL
     OR v_new_priority < v_existing_priority THEN
    RETURN QUERY SELECT v_existing.id, 'skipped_downgrade'::text;
    RETURN;
  END IF;

  IF v_new_priority = v_existing_priority AND v_existing.quantity = p_quantity THEN
    RETURN QUERY SELECT v_existing.id, 'skipped_no_change'::text;
    RETURN;
  END IF;

  UPDATE orders
  SET customer_certainty     = p_customer_certainty,
      quantity                = p_quantity,
      source_type             = p_source_type,
      source_raw              = p_source_raw,
      extracted_product_name  = v_extracted_name
  WHERE id = v_existing.id;

  RETURN QUERY SELECT v_existing.id, 'updated'::text;
END;
$$;
