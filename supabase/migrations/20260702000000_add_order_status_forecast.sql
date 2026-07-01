-- 受注PDF自動パース＋複数order生成 (Issue #249)
-- orders.status に forecast / forecast_tentative を追加し、
-- PDFパースで生成した order の重複排除用 UNIQUE 制約、
-- 重複スキップ・照合失敗を記録する order_parse_log テーブルを追加する。

-- ==========================================
-- orders.status: forecast / forecast_tentative を追加
-- ==========================================
-- text CHECK制約のため ALTER TYPE ADD VALUE は使えず、DROP + 再作成する。
ALTER TABLE orders DROP CONSTRAINT orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('draft', 'confirmed', 'completed', 'canceled', 'forecast', 'forecast_tentative'));

COMMENT ON COLUMN orders.status IS
  '注文ステータス: draft(下書き), confirmed(確定/スケジュール済), completed(完了), canceled(キャンセル), '
  'forecast(内示), forecast_tentative(内々示)';

-- ==========================================
-- orders: PDFパース由来の重複排除用 UNIQUE 制約
-- ==========================================
-- 既存行と (tenant_id, customer_id, product_id, deadline_date) が一致する場合は重複とみなす。
-- 既知の制約: product_id または customer_id が NULL の行は NULL の非等価性により
-- デデュープキーとして機能しない（PDFパース処理側では product_id が確定した場合のみ
-- このUNIQUE制約に依拠したINSERTを行うことで運用上回避する）。
ALTER TABLE orders ADD CONSTRAINT orders_dedupe_key
  UNIQUE (tenant_id, customer_id, product_id, deadline_date);

-- ==========================================
-- order_parse_log: 重複スキップ・照合失敗ログ
-- ==========================================
CREATE TABLE order_parse_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  order_attachment_id uuid REFERENCES order_attachments(id) ON DELETE CASCADE,
  reason              text NOT NULL,
  detail              jsonb,
  created_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE order_parse_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant isolation" ON order_parse_log
  FOR ALL
  USING ((auth.jwt() ->> 'tenant_id')::uuid = tenant_id);

-- ==========================================
-- create_order_skip_duplicate: 重複時 INSERT をスキップする RPC
-- ==========================================
-- supabase-py (postgrest-py) の insert(..., on_conflict=...) は UPSERT 用であり
-- 「重複時スキップ」を表現できないため、SQL側で ON CONFLICT DO NOTHING を実装する。
CREATE OR REPLACE FUNCTION create_order_skip_duplicate(
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
RETURNS TABLE (id bigint, inserted boolean)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_id bigint;
BEGIN
  INSERT INTO orders (
    tenant_id, customer_id, product_id, quantity, deadline_date,
    status, source_type, source_raw, extracted_product_name
  )
  VALUES (
    p_tenant_id, p_customer_id, p_product_id, p_quantity, p_deadline_date,
    p_status, p_source_type, p_source_raw, p_extracted_product_name
  )
  ON CONFLICT ON CONSTRAINT orders_dedupe_key DO NOTHING
  RETURNING orders.id INTO v_id;

  IF v_id IS NULL THEN
    RETURN QUERY SELECT NULL::bigint, false;
  ELSE
    RETURN QUERY SELECT v_id, true;
  END IF;
END;
$$;
