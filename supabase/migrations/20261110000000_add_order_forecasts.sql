-- 注文書の内示を受注にせず保存する (Issue #676)
--
-- 注文書の内示・内々示の明細（確度 forecast / forecast_tentative）は、これまで下書きの受注として
-- 起票していた。内示は月単位の見込みで、その月の初旬に改めて注文が来るため起票は要らないが、
-- 前もって着手・材料を手配するために数量は見たい。日付の無い内示を受注にすると、希望納期が NULL で
-- 重複判定に当たらず再送のたびに二重に起票され、承認されると生産スケジュールが設備を占めていた。
--
-- 取り込み（cron、service role）が注文書（order_attachments のステージング行）ごとに内示を保存する。
-- 内示は毎月届き直すので、顧客の最新の内示は「最も新しく受信した注文書の内示」として読み出し時に決め、
-- 古い注文書の内示は前回比のために残す。
--
-- 製品・顧客の FK は ON DELETE SET NULL。重複製品・重複顧客の統合（merge_products / merge_customers）で
-- 統合元が消えても内示の行は残り、表記（extracted_product_name 等）から辿れる。統合 RPC の付け替え対象には
-- 入れていない（次の注文書からは統合先に照合される）。

CREATE TABLE order_forecasts (
  id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id               uuid NOT NULL REFERENCES tenants(id),
  -- 内示が書かれていた注文書（ステージング行）。受信日時はこの行の created_at
  source_attachment_id    uuid NOT NULL REFERENCES order_attachments(id) ON DELETE CASCADE,
  -- 抽出した明細の中での位置（0始まり。受注にした明細も数える）
  line_index              integer NOT NULL CHECK (line_index >= 0),
  -- 顧客不明（社内転送者から届き、顧客が決まらなかった注文書。Issue #521）は NULL
  customer_id             bigint REFERENCES customers(id) ON DELETE SET NULL,
  -- 照合できなかった内示は NULL（表記は残す）
  product_id              bigint REFERENCES products(id) ON DELETE SET NULL,
  product_name_raw        text,
  product_number_raw      text,
  extracted_product_name  text,
  -- 対象期間の開始月・終了月（月の1日）。読めなかった内示は両方 NULL
  period_start            date,
  period_end              date,
  -- 0 は「内示なし」。読めない値は NULL
  quantity                integer CHECK (quantity >= 0),
  certainty               text NOT NULL CHECK (certainty IN ('forecast', 'forecast_tentative')),
  created_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_forecasts_attachment_line_key UNIQUE (source_attachment_id, line_index),
  CONSTRAINT order_forecasts_period_both_or_neither
    CHECK ((period_start IS NULL) = (period_end IS NULL)),
  CONSTRAINT order_forecasts_period_first_of_month
    CHECK (
      (period_start IS NULL OR EXTRACT(DAY FROM period_start) = 1)
      AND (period_end IS NULL OR EXTRACT(DAY FROM period_end) = 1)
    ),
  CONSTRAINT order_forecasts_period_ordered CHECK (period_start <= period_end)
);

ALTER TABLE order_forecasts ENABLE ROW LEVEL SECURITY;

-- 書き込みは cron（service role）のみ。SELECT ポリシーだけを作る
CREATE POLICY "tenant members can view order forecasts" ON order_forecasts
  FOR SELECT
  USING (is_tenant_member(tenant_id));

CREATE INDEX idx_order_forecasts_tenant_customer
  ON order_forecasts (tenant_id, customer_id);

CREATE INDEX idx_order_forecasts_product
  ON order_forecasts (product_id);

-- ---------------------------------------------------------------------------
-- replace_order_forecasts: 注文書1件の内示を丸ごと置き換える
-- ---------------------------------------------------------------------------
-- cron が同じステージング行を処理し直しても内示が二重にならないよう、その注文書の内示を DELETE してから
-- INSERT する（1トランザクション）。p_tenant_id は呼び出し側がステージング行から解決した値で、
-- 注文書が別テナントのものなら例外にする。保存した行数を返す。
CREATE OR REPLACE FUNCTION replace_order_forecasts(
  p_tenant_id      uuid,
  p_attachment_id  uuid,
  p_customer_id    bigint,
  p_rows           jsonb
)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  PERFORM 1
    FROM order_attachments a
   WHERE a.id = p_attachment_id
     AND a.tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order attachment not found for tenant';
  END IF;

  DELETE FROM order_forecasts
   WHERE tenant_id = p_tenant_id
     AND source_attachment_id = p_attachment_id;

  INSERT INTO order_forecasts (
    tenant_id, source_attachment_id, line_index, customer_id, product_id,
    product_name_raw, product_number_raw, extracted_product_name,
    period_start, period_end, quantity, certainty
  )
  SELECT
    p_tenant_id, p_attachment_id, r.line_index, p_customer_id, r.product_id,
    r.product_name_raw, r.product_number_raw, r.extracted_product_name,
    r.period_start, r.period_end, r.quantity, r.certainty
  FROM jsonb_to_recordset(COALESCE(p_rows, '[]'::jsonb)) AS r(
    line_index              integer,
    product_id              bigint,
    product_name_raw        text,
    product_number_raw      text,
    extracted_product_name  text,
    period_start            date,
    period_end              date,
    quantity                integer,
    certainty               text
  );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- SECURITY INVOKER なのでユーザー JWT から呼んでも RLS（書き込みポリシー無し）で弾かれるが、
-- service role 専用であることを明示するため実行権限も絞る。
REVOKE EXECUTE ON FUNCTION replace_order_forecasts(uuid, uuid, bigint, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION replace_order_forecasts(uuid, uuid, bigint, jsonb)
  TO service_role;
