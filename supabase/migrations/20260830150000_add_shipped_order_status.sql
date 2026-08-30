-- ==========================================
-- orders.status に shipped (送品済み) を追加
--
-- 確定済 (confirmed) の受注を出荷・納品したことを表す状態。
-- confirmed からのみ遷移でき、shipped は実質的な終端状態
-- (以降の順方向遷移は無し)。遷移バリデーション自体は
-- backend/app/services/order_status_service.py で行う。
--
-- status の遷移:
--   draft -> pending_approval -> confirmed -> completed / canceled
--                                          -> shipped
-- ==========================================

ALTER TABLE orders DROP CONSTRAINT orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('draft', 'pending_approval', 'confirmed', 'completed', 'canceled', 'shipped'));

COMMENT ON COLUMN orders.status IS
  'ProductPlannerのワークフローステータス: draft(下書き), '
  'pending_approval(受注担当者の修正完了・社長承認待ち), '
  'confirmed(確定/スケジュール済), shipped(送品済み), '
  'completed(完了), canceled(キャンセル)。'
  'draft -> pending_approval -> confirmed -> completed/canceled の順方向にのみ'
  '遷移する（差し戻し pending_approval -> draft のみ例外）。confirmed からは'
  'shipped へも遷移できる。confirmed へはユーザーの確定操作(/orders/{id}/confirm)'
  'でのみ遷移する。顧客側の確度は customer_certainty を参照。';

-- ==========================================
-- upsert_order_by_dedupe_key: shipped も自動処理からの保護対象に追加
--
-- 20260810000002_add_pending_approval_order_status.sql 時点の最新定義をベースに、
-- 保護対象の status へ shipped を追加するのみの差分を適用する。
-- 送品済みの受注をメール/PDF自動処理が誤って上書き・降格させないようにする。
-- ==========================================
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

  -- pending_approval/confirmed/shipped/completed/canceled (受注担当者が承認申請した、
  -- ユーザーが確定・送品・完了させた、もしくはキャンセルした注文)
  -- はPDF自動処理から完全に保護し、常にコンフリクトとしてログのみ記録する。
  IF v_existing.status IN ('pending_approval', 'confirmed', 'shipped', 'completed', 'canceled') THEN
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
