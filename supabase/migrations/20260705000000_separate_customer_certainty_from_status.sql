-- 顧客側の確度(certainty)とProductPlanner側のワークフローステータス(status)を分離する (Issue #267)
--
-- 背景: pdf_order_parsing_service.py が PDF明細の certainty (確定/内示/内々示という
-- 「顧客側の確度」) をそのまま orders.status (「ProductPlannerのワークフローステータス」。
-- 本来 draft -> confirmed はユーザーの確定操作 (/orders/{id}/confirm) でのみ遷移すべき)
-- に1:1でマッピングしていたため、メール/PDF転送起票の注文がユーザーの確認・確定操作
-- なしに status='confirmed' として作成されてしまっていた。
--
-- 本マイグレーションでは、顧客側の確度を保持する専用カラム orders.customer_certainty を
-- 新設し、orders.status は元の4値 (draft/confirmed/completed/canceled) に戻す。

-- ==========================================
-- orders.customer_certainty カラム追加
-- ==========================================
ALTER TABLE orders ADD COLUMN customer_certainty text
  CHECK (customer_certainty IN ('confirmed', 'forecast', 'forecast_tentative'));

COMMENT ON COLUMN orders.customer_certainty IS
  'PDF/メール文面から抽出した顧客側の確度: confirmed(確定納期・PO番号明記), '
  'forecast(内示), forecast_tentative(内々示)。ProductPlanner側のワークフロー'
  'ステータス(status)とは独立した値であり、status を自動で変化させない。'
  '手動起票の注文では NULL。';

-- ==========================================
-- 既存データの是正
-- ==========================================
-- status='forecast'/'forecast_tentative' だった行は、値を customer_certainty に退避し
-- status は 'draft' に戻す。
UPDATE orders
SET customer_certainty = status,
    status = 'draft'
WHERE status IN ('forecast', 'forecast_tentative');

-- status='confirmed' かつ confirmed_at IS NULL の行は、ユーザーが一度も
-- /orders/{id}/confirm を実行していないにも関わらず、本バグにより
-- certainty='confirmed' から直接 status='confirmed' にされてしまった行なので、
-- customer_certainty='confirmed' を設定した上で status='draft' に是正する。
UPDATE orders
SET customer_certainty = 'confirmed',
    status = 'draft'
WHERE status = 'confirmed'
  AND confirmed_at IS NULL;

-- ==========================================
-- orders.status: forecast / forecast_tentative を除外し元の4値に戻す
-- ==========================================
ALTER TABLE orders DROP CONSTRAINT orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('draft', 'confirmed', 'completed', 'canceled'));

COMMENT ON COLUMN orders.status IS
  'ProductPlannerのワークフローステータス: draft(下書き), confirmed(確定/スケジュール済), '
  'completed(完了), canceled(キャンセル)。confirmed へはユーザーの確定操作'
  '(/orders/{id}/confirm) でのみ遷移する。顧客側の確度は customer_certainty を参照。';

-- ==========================================
-- upsert_order_by_dedupe_key: p_status を廃止し p_customer_certainty に置き換え
-- ==========================================
-- INSERT時は常に status='draft' で作成する。既存行が confirmed/completed/canceled
-- (=ユーザーが確定・完了、またはキャンセルした注文) の場合は常に保護する。
-- 既存行が draft かつ source_type='manual' (手動下書き) の場合も従来通り保護する。
-- それ以外 (draft かつ source_type != 'manual' = メール/PDF起票の確認待ちdraft) の
-- 場合のみ、customer_certainty の優先順位で upsert 判定を行う。
DROP FUNCTION IF EXISTS upsert_order_by_dedupe_key(
  uuid, bigint, bigint, int, date, text, text, text, text
);

CREATE OR REPLACE FUNCTION upsert_order_by_dedupe_key(
  p_tenant_id             uuid,
  p_customer_id           bigint,
  p_product_id            bigint,
  p_quantity              int,
  p_deadline_date         date,
  p_customer_certainty    text,
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
  -- 先にINSERTを試み、UNIQUE制約(orders_dedupe_key)の競合でしか
  -- 「既存あり」を判定しない。SELECTしてから未存在ならINSERTする順序だと、
  -- 同一dedupeキーへの並行呼び出しが両方SELECTでNOT FOUNDと判定してしまい、
  -- 片方が23505で例外終了する競合が起こり得るため。
  INSERT INTO orders (
    tenant_id, customer_id, product_id, quantity, deadline_date,
    status, customer_certainty, source_type, source_raw, extracted_product_name
  )
  VALUES (
    p_tenant_id, p_customer_id, p_product_id, p_quantity, p_deadline_date,
    'draft', p_customer_certainty, p_source_type, p_source_raw, p_extracted_product_name
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
  -- 既存行の customer_certainty が NULL（本文のみのメール起票等、確度情報を
  -- 持たないdraft）の場合は最も低い優先度(-1)として扱い、PDF取込による
  -- 確度付け・更新を妨げないようにする。
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

  -- p_customer_certainty がCHECK制約の許容値以外だった場合
  -- (呼び出し元での正規化漏れ等) は更新せずコンフリクト扱いにする
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
      extracted_product_name  = p_extracted_product_name
  WHERE id = v_existing.id;

  RETURN QUERY SELECT v_existing.id, 'updated'::text;
END;
$$;
