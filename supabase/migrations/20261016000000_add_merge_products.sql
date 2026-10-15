-- 表記ゆれで重複登録された製品の統合 (Issue #515)
--
-- 製品マスタの「重複の統合」画面から、残す製品1件に統合される製品の受注・スケジュール・別名を
-- 付け替え、統合される側の工程・製品を物理削除する。事前チェック（受注の重複キーの衝突・工程の
-- 対応）は backend/app/services/product_merge_service.py で行い、ここでは実行だけを1トランザクションで行う。
-- プレビュー後に状況が変わった場合は、制約違反（受注の UNIQUE 23505 / 工程を参照するスケジュールが
-- 残る FK 23503）や削除件数の不一致で全体を失敗させる（呼び出し側はプレビューからやり直す）。

-- ---------------------------------------------------------------------------
-- product_name_alias_history: 統合で product_id を付け替えられるようにする
-- ---------------------------------------------------------------------------
-- 履歴は追記のみで UPDATE ポリシーが無い（#347）。統合のときだけ product_id を残す製品へ
-- 付け替えたいので、更新できる列を product_id に絞ったうえで president / platform_admin に
-- UPDATE を許可する（付け替えないと製品の削除で ON DELETE SET NULL になり、どの製品の履歴か追えなくなる）。
REVOKE UPDATE ON product_name_alias_history FROM anon, authenticated;
GRANT UPDATE (product_id) ON product_name_alias_history TO authenticated;

CREATE POLICY "presidents can repoint product_name_alias_history"
  ON product_name_alias_history
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
        FROM organization_members m
       WHERE m.tenant_id = product_name_alias_history.tenant_id
         AND m.user_id = auth.uid()
         AND m.role IN ('president', 'platform_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM organization_members m
       WHERE m.tenant_id = product_name_alias_history.tenant_id
         AND m.user_id = auth.uid()
         AND m.role IN ('president', 'platform_admin')
    )
  );

-- ---------------------------------------------------------------------------
-- merge_products: 重複製品を残す製品へ統合する
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER（ユーザー JWT で呼び、RLS 下で動く）。各テーブルの書き込みは既存の
-- テナントメンバー向けポリシーで許可されている。日報の進捗・未割当実績
-- （order_process_progress / daily_report_unallocated_actuals）は工程・製品の削除の CASCADE で消え、
-- cron compute-daily-report-progress の次回の再計算で反映される（参照整合性の CASCADE は RLS を受けない）。
--
--   p_delete_order_ids  付け替えると orders_dedupe_key が衝突するため削除する、統合される側の出荷済みの受注
--
-- 戻り値は付け替え・削除の件数（product_merge_service.ProductMergeCounts と同じキー）。
CREATE OR REPLACE FUNCTION merge_products(
  p_tenant_id          uuid,
  p_keep_product_id    bigint,
  p_merge_product_ids  bigint[],
  p_delete_order_ids   bigint[] DEFAULT '{}'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_merge_ids                 bigint[];
  v_delete_ids                bigint[];
  v_product_count             integer;
  v_orders_deleted            integer;
  v_schedules_reassigned      integer;
  v_orders_reassigned         integer;
  v_aliases_reassigned        integer;
  v_alias_history_reassigned  integer;
  v_routings_deleted          integer;
  v_products_deleted          integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM organization_members m
     WHERE m.tenant_id = p_tenant_id
       AND m.user_id = auth.uid()
       AND m.role IN ('president', 'platform_admin')
  ) THEN
    RAISE EXCEPTION 'merge_products: permission denied' USING ERRCODE = '42501';
  END IF;

  v_merge_ids := ARRAY(SELECT DISTINCT unnest(COALESCE(p_merge_product_ids, '{}')));
  v_delete_ids := ARRAY(SELECT DISTINCT unnest(COALESCE(p_delete_order_ids, '{}')));
  IF cardinality(v_merge_ids) = 0 OR p_keep_product_id = ANY(v_merge_ids) THEN
    RAISE EXCEPTION 'merge_products: invalid product ids' USING ERRCODE = '22023';
  END IF;

  -- 日報の割り付けの置き換え（replace_daily_report_allocation）と重ならないようにする。
  -- 計算後に消えた工程へ INSERT して失敗するのを避けるため、同じ advisory lock を取る
  PERFORM pg_advisory_xact_lock(
    hashtextextended('daily_report_allocation:' || p_tenant_id::text, 0)
  );

  SELECT count(*) INTO v_product_count
    FROM (
      SELECT p.id
        FROM products p
       WHERE p.tenant_id = p_tenant_id
         AND p.id = ANY(v_merge_ids || p_keep_product_id)
         FOR UPDATE
    ) locked;
  IF v_product_count <> cardinality(v_merge_ids) + 1 THEN
    RAISE EXCEPTION 'merge_products: product not found' USING ERRCODE = 'P0002';
  END IF;

  -- 1. 重複キーが衝突する出荷済みの受注を削除する（スケジュール等は CASCADE）
  DELETE FROM orders o
   WHERE o.tenant_id = p_tenant_id
     AND o.id = ANY(v_delete_ids)
     AND o.product_id = ANY(v_merge_ids)
     AND o.status = 'shipped';
  GET DIAGNOSTICS v_orders_deleted = ROW_COUNT;
  IF v_orders_deleted <> cardinality(v_delete_ids) THEN
    RAISE EXCEPTION 'merge_products: stale order plan' USING ERRCODE = 'P0001';
  END IF;

  -- 2. スケジュールを残す製品の同じ sequence_order の工程へ付け替える（時刻・設備は変えない）。
  --    対応する工程が無いセグメントは残り、4. の工程の削除が FK で失敗する
  UPDATE production_schedules ps
     SET process_routing_id = kr.id
    FROM process_routings mr
    JOIN process_routings kr
      ON kr.tenant_id = p_tenant_id
     AND kr.product_id = p_keep_product_id
     AND kr.sequence_order = mr.sequence_order
   WHERE ps.tenant_id = p_tenant_id
     AND ps.process_routing_id = mr.id
     AND mr.tenant_id = p_tenant_id
     AND mr.product_id = ANY(v_merge_ids);
  GET DIAGNOSTICS v_schedules_reassigned = ROW_COUNT;

  -- 3. 受注・別名・別名履歴を残す製品へ付け替える（受注の重複キーの衝突は 23505 で失敗する）
  UPDATE orders o
     SET product_id = p_keep_product_id
   WHERE o.tenant_id = p_tenant_id
     AND o.product_id = ANY(v_merge_ids);
  GET DIAGNOSTICS v_orders_reassigned = ROW_COUNT;

  UPDATE product_name_aliases a
     SET product_id = p_keep_product_id,
         updated_at = now()
   WHERE a.tenant_id = p_tenant_id
     AND a.product_id = ANY(v_merge_ids);
  GET DIAGNOSTICS v_aliases_reassigned = ROW_COUNT;

  UPDATE product_name_alias_history h
     SET product_id = p_keep_product_id
   WHERE h.tenant_id = p_tenant_id
     AND h.product_id = ANY(v_merge_ids);
  GET DIAGNOSTICS v_alias_history_reassigned = ROW_COUNT;

  -- 4. 統合される側の工程・製品を削除する
  DELETE FROM process_routings r
   WHERE r.tenant_id = p_tenant_id
     AND r.product_id = ANY(v_merge_ids);
  GET DIAGNOSTICS v_routings_deleted = ROW_COUNT;

  DELETE FROM products p
   WHERE p.tenant_id = p_tenant_id
     AND p.id = ANY(v_merge_ids);
  GET DIAGNOSTICS v_products_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'orders_reassigned', v_orders_reassigned,
    'schedules_reassigned', v_schedules_reassigned,
    'aliases_reassigned', v_aliases_reassigned,
    'alias_history_reassigned', v_alias_history_reassigned,
    'orders_deleted', v_orders_deleted,
    'routings_deleted', v_routings_deleted,
    'products_deleted', v_products_deleted
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION merge_products(uuid, bigint, bigint[], bigint[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION merge_products(uuid, bigint, bigint[], bigint[])
  TO authenticated;
