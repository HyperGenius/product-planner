-- ==========================================
-- 顧客別プロンプトによる受注書の注文番号抽出（Issue #366 / dedupe統合 #365 の前段）
--
-- 1. customers.order_extraction_prompt: 顧客ごとの抽出指示（自然言語のプロンプト断片）。
--    NULL の顧客は従来どおり汎用プロンプトのみで抽出する（挙動不変）。
--    RLS は customers の既存 tenant isolation ポリシーで自動的にカバーされる。
-- 2. orders.customer_order_no: 顧客側の注文番号／注文No.。制約なし・NULL 許容。
--    社内採番の orders.order_number（テナント内ユニーク）とは意味が異なるため流用しない。
--    本Issueでは保存・観察のみ。dedupe キー・優先順位判定には一切使わない。
-- 3. upsert_order_by_dedupe_key RPC に p_customer_order_no を追加し、INSERT／UPDATE 時に
--    保存する。dedupe キー・優先順位ロジックは 20260830150000 時点の定義から一切変更しない。
-- ==========================================

ALTER TABLE customers ADD COLUMN order_extraction_prompt text;
COMMENT ON COLUMN customers.order_extraction_prompt IS
  '受注書（PDF／メール本文）からの明細抽出時に、汎用プロンプトへ追記する顧客固有の'
  '抽出指示（自然言語のプロンプト断片）。ツールスキーマ（フィールド定義）は変更せず、'
  '「どこを見てどう埋めるか」の指示のみ。NULL の顧客は汎用プロンプトのみで処理する。';

ALTER TABLE orders ADD COLUMN customer_order_no text;
COMMENT ON COLUMN orders.customer_order_no IS
  '顧客側の注文番号／注文No.（明細レベル line_order_no があればそれ、無ければ文書レベル'
  'document_order_no、いずれも無ければアプリ側で文書内容から決定的に採番した値）。'
  '社内採番の order_number とは別物で制約なし。Issue #366 時点では観察用で、'
  'dedupe キー・優先順位判定には使用しない（#365 で dedupe へ統合予定）。';

-- ==========================================
-- upsert_order_by_dedupe_key: p_customer_order_no を追加
--
-- 20260830150000_add_shipped_order_status.sql 時点の最新定義をベースに、
-- p_customer_order_no パラメータ（DEFAULT NULL）を追加し、各 INSERT と UPDATE で
-- customer_order_no を保存するのみの差分。dedupe キー・優先順位判定は変更しない。
--
-- 末尾に DEFAULT 付きパラメータを追加すると旧シグネチャの関数が残り、10引数呼び出しが
-- あいまいになるため、旧シグネチャを先に DROP してから作り直す。
-- ==========================================
DROP FUNCTION IF EXISTS upsert_order_by_dedupe_key(
  uuid, bigint, bigint, int, date, text, text, text, text, uuid
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
  p_source_attachment_id   uuid DEFAULT NULL,
  p_customer_order_no      text DEFAULT NULL
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
  v_customer_order_no text := NULLIF(TRIM(p_customer_order_no), '');
BEGIN
  IF p_product_id IS NULL THEN
    IF v_extracted_name IS NULL OR p_deadline_date IS NULL THEN
      -- 重複判定に使える情報（品名・納期）が不足しているため、常に新規行として
      -- 挿入する（取りこぼしを許容する。Issue #296 未解決の問題として明記済み）。
      INSERT INTO orders (
        tenant_id, customer_id, product_id, quantity, deadline_date,
        status, customer_certainty, source_type, source_raw, extracted_product_name,
        source_attachment_id, customer_order_no
      )
      VALUES (
        p_tenant_id, p_customer_id, NULL, p_quantity, p_deadline_date,
        'draft', p_customer_certainty, p_source_type, p_source_raw, v_extracted_name,
        p_source_attachment_id, v_customer_order_no
      )
      RETURNING orders.id INTO v_new_id;

      RETURN QUERY SELECT v_new_id, 'inserted'::text;
      RETURN;
    END IF;

    INSERT INTO orders (
      tenant_id, customer_id, product_id, quantity, deadline_date,
      status, customer_certainty, source_type, source_raw, extracted_product_name,
      source_attachment_id, customer_order_no
    )
    VALUES (
      p_tenant_id, p_customer_id, NULL, p_quantity, p_deadline_date,
      'draft', p_customer_certainty, p_source_type, p_source_raw, v_extracted_name,
      p_source_attachment_id, v_customer_order_no
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
      source_attachment_id, customer_order_no
    )
    VALUES (
      p_tenant_id, p_customer_id, p_product_id, p_quantity, p_deadline_date,
      'draft', p_customer_certainty, p_source_type, p_source_raw, v_extracted_name,
      p_source_attachment_id, v_customer_order_no
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
      extracted_product_name  = v_extracted_name,
      customer_order_no       = COALESCE(v_customer_order_no, customer_order_no)
  WHERE id = v_existing.id;

  RETURN QUERY SELECT v_existing.id, 'updated'::text;
END;
$$;
