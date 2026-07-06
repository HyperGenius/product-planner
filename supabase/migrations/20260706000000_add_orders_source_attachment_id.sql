-- 受注ソースの「1ソース:N受注」モデル対応 (Issue #280)
-- メール本文・添付ファイルを「ソース」(order_attachments) として orders から独立させ、
-- 1ソースに対してN件の orders を紐づけられるようにする。

-- ==========================================
-- orders.source_attachment_id カラム追加
-- ==========================================
ALTER TABLE orders ADD COLUMN source_attachment_id uuid REFERENCES order_attachments(id);

COMMENT ON COLUMN orders.source_attachment_id IS
  '受注の起票元となった order_attachments 行（1ソース）への参照。'
  'PDF/メール本文起票の受注は自動抽出処理が参照する order_attachments のステージング行'
  '（order_id IS NULL）を指す。手動作成の受注では NULL。';

CREATE INDEX idx_orders_source_attachment_id ON orders (source_attachment_id);

-- ==========================================
-- 既存データのバックフィル
-- ==========================================
-- PDF由来: order_id IS NULL のステージング行と、そこから生成された各 orders に
-- 紐づく order_attachments 行（storage_path を複製したもの）を対応付けて設定する。
-- 手動作成の受注（source_type != 'email'）は、たまたま同一storage_pathの添付を
-- 持っていたとしても対象外とする（コメント通り手動作成はNULLのままにするため）。
UPDATE orders o
SET source_attachment_id = staging.id
FROM order_attachments staging
JOIN order_attachments real_att
  ON real_att.storage_path = staging.storage_path
 AND real_att.tenant_id = staging.tenant_id
WHERE staging.order_id IS NULL
  AND real_att.order_id = o.id
  AND o.source_attachment_id IS NULL
  AND o.source_type = 'email';

-- 非PDF添付・添付なしメール由来: 専用のステージング行が存在しないため、
-- その orders に紐づく order_attachments 行自身を自己参照的な「ソース」として設定する。
-- 手動作成の受注（source_type != 'email'）は対象外とする。
UPDATE orders o
SET source_attachment_id = oa.id
FROM order_attachments oa
WHERE oa.order_id = o.id
  AND o.source_attachment_id IS NULL
  AND o.source_type = 'email';

-- ==========================================
-- upsert_order_by_dedupe_key: p_source_attachment_id を追加
-- ==========================================
-- 新規INSERT時にのみ source_attachment_id を設定する。既存行のupdate時は
-- 最初にレコードを作成したソースを保ったままにする（更新元のソースへの付け替えは行わない）。
DROP FUNCTION IF EXISTS upsert_order_by_dedupe_key(
  uuid, bigint, bigint, int, date, text, text, text, text
);

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
    status, customer_certainty, source_type, source_raw, extracted_product_name,
    source_attachment_id
  )
  VALUES (
    p_tenant_id, p_customer_id, p_product_id, p_quantity, p_deadline_date,
    'draft', p_customer_certainty, p_source_type, p_source_raw, p_extracted_product_name,
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
      extracted_product_name  = p_extracted_product_name
  WHERE id = v_existing.id;

  RETURN QUERY SELECT v_existing.id, 'updated'::text;
END;
$$;

-- ==========================================
-- notifications.notif_type: multi_order_suspected を追加
-- ==========================================
-- 自動抽出時に複数受注の疑いがあるケース（数量異常値等）を検知した際の通知 (Issue #280)。
ALTER TABLE notifications DROP CONSTRAINT notifications_notif_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_notif_type_check
CHECK (notif_type IN (
  'no_product_match', 'downgrade_skipped', 'draft_conflict_skipped',
  'failed_encrypted', 'failed_image', 'non_order_email', 'customer_draft_created',
  'multi_order_suspected'
));
