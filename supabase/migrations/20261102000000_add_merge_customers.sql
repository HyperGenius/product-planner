-- 重複登録された顧客の統合 (Issue #610)
--
-- 同じ会社が担当者名つきの下書き顧客などで重複登録されたとき、顧客マスタの「顧客の統合」から
-- 統合される顧客の参照を残す顧客へ付け替え、統合される側の顧客を物理削除する。事前チェック
-- （受注の重複キーの衝突）は backend/app/services/customer_merge_service.py で行い、ここでは実行だけを
-- 1トランザクションで行う（製品の統合 merge_products と同じ設計。Issue #515）。
-- プレビュー後に状況が変わった場合は、制約違反（受注の UNIQUE 23505）や削除件数の不一致で全体を失敗させる。
--
-- 顧客を参照する FK 一覧（新しく足すときは、ここの付け替えに入れるか CASCADE にするかを決める）:
--   orders / order_attachments                  付け替え
--   product_name_aliases                        付け替え（UNIQUE の衝突は統合先を優先して統合される側を捨てる）
--   product_name_alias_history                  付け替え（customer_name_snapshot は当時の名前のまま残す）
--   customer_name_aliases                       付け替え
--   daily_report_unallocated_actuals            付け替え（日報の再計算で作り直される結果。SET NULL で顧客が消えるのを避ける）
--   customer_extraction_prompt_history          付け替え（CASCADE で消えるのを避ける）
--   customer_contacts                           付け替え（統合される側の customers.email も担当者へ移す）

-- ---------------------------------------------------------------------------
-- 統合の履歴: どの顧客をどこへ統合したかを追えるようにする（追記のみ）
-- ---------------------------------------------------------------------------
CREATE TABLE customer_merge_log (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  keep_customer_id   bigint REFERENCES customers(id) ON DELETE SET NULL,
  keep_customer_name text NOT NULL,
  merged_customers   jsonb NOT NULL,
  counts             jsonb NOT NULL,
  merged_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  merged_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE customer_merge_log IS
  '顧客の統合の履歴（追記のみ）。書き込みは RPC merge_customers だけが行う。'
  'merged_customers は統合された顧客の統合時点の {id, name, alias, email}、counts は付け替えの件数。'
  '統合先の顧客が後で削除されると keep_customer_id は NULL になる（keep_customer_name は残る）。';

CREATE INDEX idx_customer_merge_log_tenant ON customer_merge_log (tenant_id, id DESC);

ALTER TABLE customer_merge_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members can view customer_merge_log"
  ON customer_merge_log
  FOR SELECT
  USING (is_tenant_member(tenant_id));

CREATE POLICY "presidents can insert customer_merge_log"
  ON customer_merge_log
  FOR INSERT
  WITH CHECK (
    merged_by = auth.uid()
    AND EXISTS (
      SELECT 1
        FROM organization_members m
       WHERE m.tenant_id = customer_merge_log.tenant_id
         AND m.user_id = auth.uid()
         AND m.role IN ('president', 'platform_admin')
    )
  );

-- ---------------------------------------------------------------------------
-- 追記のみ・参照専用のテーブルで customer_id だけ付け替えられるようにする
-- ---------------------------------------------------------------------------
-- UPDATE ポリシーが無い3テーブルについて、更新できる列を customer_id に絞ったうえで
-- president / platform_admin に UPDATE を許可する（#515 の product_name_alias_history と同じ方針）。
-- product_name_alias_history は #515 のポリシーが既にあるので列の GRANT だけ足す。
GRANT UPDATE (product_id, customer_id) ON product_name_alias_history TO authenticated;

REVOKE UPDATE ON daily_report_unallocated_actuals FROM anon, authenticated;
GRANT UPDATE (customer_id) ON daily_report_unallocated_actuals TO authenticated;

REVOKE UPDATE ON customer_extraction_prompt_history FROM anon, authenticated;
GRANT UPDATE (customer_id) ON customer_extraction_prompt_history TO authenticated;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['daily_report_unallocated_actuals', 'customer_extraction_prompt_history']
  LOOP
    EXECUTE format(
      'CREATE POLICY "presidents can repoint %1$s" ON %1$I FOR UPDATE '
      'USING (EXISTS (SELECT 1 FROM organization_members m '
      'WHERE m.tenant_id = %1$I.tenant_id AND m.user_id = auth.uid() '
      'AND m.role IN (''president'', ''platform_admin''))) '
      'WITH CHECK (EXISTS (SELECT 1 FROM organization_members m '
      'WHERE m.tenant_id = %1$I.tenant_id AND m.user_id = auth.uid() '
      'AND m.role IN (''president'', ''platform_admin'')))', t);
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- merge_customers: 重複顧客を残す顧客へ統合する
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER（ユーザー JWT で呼び、RLS 下で動く）。
--
-- 戻り値は付け替え・削除の件数（customer_merge_service.CustomerMergeCounts と同じキー）。
-- エラー: 42501 権限なし / 22023 引数が不正 / P0002 顧客が無い / 23505 受注の重複 / P0001 削除件数の不一致
CREATE OR REPLACE FUNCTION merge_customers(
  p_tenant_id          uuid,
  p_keep_customer_id   bigint,
  p_merge_customer_ids bigint[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_merge_ids                   bigint[];
  v_customer_count              integer;
  v_keep_name                   text;
  v_merged_snapshot             jsonb;
  v_aliases_dropped             integer;
  v_orders_reassigned           integer;
  v_attachments_reassigned      integer;
  v_aliases_reassigned          integer;
  v_alias_history_reassigned    integer;
  v_customer_aliases_reassigned integer;
  v_unallocated_reassigned      integer;
  v_prompt_history_reassigned   integer;
  v_contacts_reassigned         integer;
  v_contacts_added              integer;
  v_customers_deleted           integer;
  v_counts                      jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM organization_members m
     WHERE m.tenant_id = p_tenant_id
       AND m.user_id = auth.uid()
       AND m.role IN ('president', 'platform_admin')
  ) THEN
    RAISE EXCEPTION 'merge_customers: permission denied' USING ERRCODE = '42501';
  END IF;

  v_merge_ids := ARRAY(SELECT DISTINCT unnest(COALESCE(p_merge_customer_ids, '{}')));
  IF cardinality(v_merge_ids) = 0 OR p_keep_customer_id = ANY(v_merge_ids) THEN
    RAISE EXCEPTION 'merge_customers: invalid customer ids' USING ERRCODE = '22023';
  END IF;

  -- 日報の割り付けの置き換え（replace_daily_report_allocation）と重ならないようにする（merge_products と同じ）
  PERFORM pg_advisory_xact_lock(
    hashtextextended('daily_report_allocation:' || p_tenant_id::text, 0)
  );

  SELECT count(*) INTO v_customer_count
    FROM (
      SELECT c.id
        FROM customers c
       WHERE c.tenant_id = p_tenant_id
         AND c.id = ANY(v_merge_ids || p_keep_customer_id)
         FOR UPDATE
    ) locked;
  IF v_customer_count <> cardinality(v_merge_ids) + 1 THEN
    RAISE EXCEPTION 'merge_customers: customer not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT c.name INTO v_keep_name
    FROM customers c
   WHERE c.tenant_id = p_tenant_id AND c.id = p_keep_customer_id;

  -- 履歴に残す統合される側の顧客の統合時点の内容（削除してからでは追えない）
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object('id', c.id, 'name', c.name, 'alias', c.alias, 'email', c.email)
           ORDER BY c.id), '[]'::jsonb)
    INTO v_merged_snapshot
    FROM customers c
   WHERE c.tenant_id = p_tenant_id AND c.id = ANY(v_merge_ids);

  -- 1. 製品の別名: (顧客, 表記) の UNIQUE が衝突する分は統合先を優先して統合される側を捨てる。
  --    統合される顧客どうしで表記が重なる分は、ID の若い顧客（同じ顧客内なら先に登録した別名）を残す
  WITH ranked AS (
    SELECT a.id,
           EXISTS (
             SELECT 1 FROM product_name_aliases k
              WHERE k.tenant_id = p_tenant_id
                AND k.customer_id = p_keep_customer_id
                AND k.raw_text = a.raw_text
           ) AS keep_has,
           row_number() OVER (
             PARTITION BY a.raw_text
             ORDER BY a.customer_id, a.created_at, a.id
           ) AS rn
      FROM product_name_aliases a
     WHERE a.tenant_id = p_tenant_id
       AND a.customer_id = ANY(v_merge_ids)
  )
  DELETE FROM product_name_aliases a
   USING ranked r
   WHERE a.id = r.id
     AND (r.keep_has OR r.rn > 1);
  GET DIAGNOSTICS v_aliases_dropped = ROW_COUNT;

  UPDATE product_name_aliases a
     SET customer_id = p_keep_customer_id,
         updated_at = now()
   WHERE a.tenant_id = p_tenant_id
     AND a.customer_id = ANY(v_merge_ids);
  GET DIAGNOSTICS v_aliases_reassigned = ROW_COUNT;

  -- 2. 注文・添付（ステージング行を含む）。受注の重複キーの衝突は 23505 で全体が失敗する
  UPDATE orders o
     SET customer_id = p_keep_customer_id
   WHERE o.tenant_id = p_tenant_id
     AND o.customer_id = ANY(v_merge_ids);
  GET DIAGNOSTICS v_orders_reassigned = ROW_COUNT;

  -- 注文の添付はトリガー trg_sync_order_attachments_customer_id が追従する。残り（注文になる前の
  -- ステージング行）をここで付け替える
  UPDATE order_attachments oa
     SET customer_id = p_keep_customer_id
   WHERE oa.tenant_id = p_tenant_id
     AND oa.customer_id = ANY(v_merge_ids);
  GET DIAGNOSTICS v_attachments_reassigned = ROW_COUNT;

  -- 3. 辞書・履歴・日報の結果
  UPDATE product_name_alias_history h
     SET customer_id = p_keep_customer_id
   WHERE h.tenant_id = p_tenant_id
     AND h.customer_id = ANY(v_merge_ids);
  GET DIAGNOSTICS v_alias_history_reassigned = ROW_COUNT;

  UPDATE customer_name_aliases a
     SET customer_id = p_keep_customer_id,
         updated_at = now()
   WHERE a.tenant_id = p_tenant_id
     AND a.customer_id = ANY(v_merge_ids);
  GET DIAGNOSTICS v_customer_aliases_reassigned = ROW_COUNT;

  UPDATE daily_report_unallocated_actuals u
     SET customer_id = p_keep_customer_id
   WHERE u.tenant_id = p_tenant_id
     AND u.customer_id = ANY(v_merge_ids);
  GET DIAGNOSTICS v_unallocated_reassigned = ROW_COUNT;

  UPDATE customer_extraction_prompt_history h
     SET customer_id = p_keep_customer_id
   WHERE h.tenant_id = p_tenant_id
     AND h.customer_id = ANY(v_merge_ids);
  GET DIAGNOSTICS v_prompt_history_reassigned = ROW_COUNT;

  -- 4. 担当者。(tenant_id, email) は UNIQUE で同じアドレスが複数の顧客に属すことは無いので衝突しない。
  --    customers.email は互換のため残している列なので、担当者に無いアドレスがあれば移す
  UPDATE customer_contacts cc
     SET customer_id = p_keep_customer_id
   WHERE cc.tenant_id = p_tenant_id
     AND cc.customer_id = ANY(v_merge_ids);
  GET DIAGNOSTICS v_contacts_reassigned = ROW_COUNT;

  INSERT INTO customer_contacts (tenant_id, customer_id, email)
  SELECT DISTINCT ON (lower(btrim(c.email)))
         p_tenant_id, p_keep_customer_id, lower(btrim(c.email))
    FROM customers c
   WHERE c.tenant_id = p_tenant_id
     AND c.id = ANY(v_merge_ids)
     AND c.email IS NOT NULL
     AND btrim(c.email) <> ''
   ORDER BY lower(btrim(c.email)), c.id
  ON CONFLICT (tenant_id, email) DO NOTHING;
  GET DIAGNOSTICS v_contacts_added = ROW_COUNT;

  -- 5. 統合される側の顧客を削除する
  DELETE FROM customers c
   WHERE c.tenant_id = p_tenant_id
     AND c.id = ANY(v_merge_ids);
  GET DIAGNOSTICS v_customers_deleted = ROW_COUNT;
  IF v_customers_deleted <> cardinality(v_merge_ids) THEN
    RAISE EXCEPTION 'merge_customers: stale customer plan' USING ERRCODE = 'P0001';
  END IF;

  v_counts := jsonb_build_object(
    'orders_reassigned', v_orders_reassigned,
    'attachments_reassigned', v_attachments_reassigned,
    'aliases_reassigned', v_aliases_reassigned,
    'aliases_dropped', v_aliases_dropped,
    'alias_history_reassigned', v_alias_history_reassigned,
    'customer_aliases_reassigned', v_customer_aliases_reassigned,
    'unallocated_actuals_reassigned', v_unallocated_reassigned,
    'prompt_history_reassigned', v_prompt_history_reassigned,
    'contacts_reassigned', v_contacts_reassigned + v_contacts_added,
    'customers_deleted', v_customers_deleted
  );

  INSERT INTO customer_merge_log (
    tenant_id, keep_customer_id, keep_customer_name, merged_customers, counts, merged_by
  ) VALUES (
    p_tenant_id, p_keep_customer_id, v_keep_name, v_merged_snapshot, v_counts, auth.uid()
  );

  RETURN v_counts;
END;
$$;

REVOKE EXECUTE ON FUNCTION merge_customers(uuid, bigint, bigint[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION merge_customers(uuid, bigint, bigint[])
  TO authenticated;
