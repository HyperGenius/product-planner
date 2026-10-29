-- 日報からの作り置き（先行着手）の推定と、現場の指摘による補正 (Issue #591, 親Issue #485)
--
-- 現場は、よく注文される製品を先に作って置いておき、注文が来たらそこから出している（現場では「在庫」と
-- 呼んでいない）。在庫数の元になるデータは日報しか無いので、日報の実績から (製品, 工程) ごとの作り置きの数を
-- 推定して見せ、違うところを指摘してもらって直す。計算は services/daily_report_stock_estimator.py（純粋関数）。
--
-- 1. orders.shipped_at: 送品済み（・完了）にした日時。日報に出てくる最後の工程の後の作り置きを、送品した
--    受注の数量で減らすのに使う。送品の経路（/ship・/ship-without-routing・/ship-overdue-drafts）が
--    複数あり、将来 completed にする経路も足しうるので、アプリではなくトリガーで書く。既存の行は埋め戻さない
--    （NULL のときは納期で代用する）。
-- 2. daily_report_stock_estimates: 推定結果。割り付けと同じく差分更新せず、cron がテナント単位で丸ごと置き換える。
-- 3. daily_report_stock_feedback: 現場の「ここは違う」の指摘（製品単位）。
-- 4. replace_daily_report_allocation に p_stock を追加（推定結果を進捗・未割当・照合状況と同じ時点で置き換える）。
-- 5. merge_products: 統合される側の指摘を残す製品へ引き継ぐ。

-- ---------------------------------------------------------------------------
-- 1. orders.shipped_at
-- ---------------------------------------------------------------------------
ALTER TABLE orders
  ADD COLUMN shipped_at timestamptz;

CREATE OR REPLACE FUNCTION set_order_shipped_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('shipped', 'completed')
     AND (TG_OP = 'INSERT' OR OLD.status NOT IN ('shipped', 'completed')) THEN
    NEW.shipped_at := COALESCE(NEW.shipped_at, now());
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_set_order_shipped_at
  BEFORE INSERT OR UPDATE OF status ON orders
  FOR EACH ROW EXECUTE PROCEDURE set_order_shipped_at();

-- ---------------------------------------------------------------------------
-- 2. daily_report_stock_estimates: 作り置きの推定数
-- ---------------------------------------------------------------------------
-- (製品, 工程) ごとに、その工程まで作ってまだ次の工程に進んでいない数のうち、確定済み・生産中の受注に
-- 割り付いていない分。推定数が 1 以上の行だけを持つ。
--   process_name        作り置きしている工程（マスタの工程名）。「この工程の後」に置いている
--   next_process_name   日報に出てくる次の工程。NULL は日報に出てくる最後の工程（送品で減る）
--   last_movement_date  最後に増減した加工日（指摘の基準日の方が新しければ基準日）
-- 書き込みは cron（service role）の RPC のみ。RLS は SELECT ポリシーだけ（order_process_progress と同じ）。
CREATE TABLE daily_report_stock_estimates (
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  product_id          bigint NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  process_name        text NOT NULL,
  next_process_name   text,
  qty                 integer NOT NULL CHECK (qty > 0),
  last_movement_date  date,
  computed_at         timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, product_id, process_name)
);

ALTER TABLE daily_report_stock_estimates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members can view daily report stock estimates" ON daily_report_stock_estimates
  FOR SELECT
  USING (is_tenant_member(tenant_id));

CREATE INDEX idx_daily_report_stock_estimates_product
  ON daily_report_stock_estimates (product_id);

-- ---------------------------------------------------------------------------
-- 3. daily_report_stock_feedback: 現場の「ここは違う」の指摘
-- ---------------------------------------------------------------------------
-- 作り置きの仕方は製品ごとに違うので、製品単位で1件（登録し直すと上書き）。
--   not_stocked    この製品は作り置きしていない（推定数を出さない）
--   stock_process  作り置きしているのは process_name の工程の後（その工程だけを出す）。
--                  baseline_qty / baseline_date があれば、その日（の作業を終えた時点）の作り置きの数として
--                  推定の起点にする
-- 書き込めるロールの制限は API 側（別名辞書と同じ）。updated_by は INSERT 時に auth.uid() と一致させる。
-- 統合（merge_products）で product_id を付け替えるため、UPDATE は別名辞書と同じくテナントメンバーなら可。
CREATE TABLE daily_report_stock_feedback (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  product_id     bigint NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('not_stocked', 'stock_process')),
  process_name   text,
  baseline_qty   integer CHECK (baseline_qty >= 0),
  baseline_date  date,
  note           text,
  updated_by     uuid NOT NULL REFERENCES auth.users(id),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT daily_report_stock_feedback_tenant_product_key UNIQUE (tenant_id, product_id),
  CONSTRAINT daily_report_stock_feedback_fields_by_kind CHECK (
    (kind = 'not_stocked'
      AND process_name IS NULL AND baseline_qty IS NULL AND baseline_date IS NULL)
    OR (kind = 'stock_process'
      AND process_name IS NOT NULL AND btrim(process_name) <> ''
      AND (baseline_qty IS NULL) = (baseline_date IS NULL))
  )
);

ALTER TABLE daily_report_stock_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members can view daily_report_stock_feedback"
  ON daily_report_stock_feedback FOR SELECT
  USING (is_tenant_member(tenant_id));

CREATE POLICY "tenant members can insert daily_report_stock_feedback"
  ON daily_report_stock_feedback FOR INSERT
  WITH CHECK (is_tenant_member(tenant_id) AND updated_by = auth.uid());

CREATE POLICY "tenant members can update daily_report_stock_feedback"
  ON daily_report_stock_feedback FOR UPDATE
  USING (is_tenant_member(tenant_id))
  WITH CHECK (is_tenant_member(tenant_id));

CREATE POLICY "tenant members can delete daily_report_stock_feedback"
  ON daily_report_stock_feedback FOR DELETE
  USING (is_tenant_member(tenant_id));

-- updated_at は API が登録・上書きのたびに書く。set_updated_at() のトリガーは付けない
-- （統合で product_id を付け替えたときに、指摘した日時が書き換わらないようにする）

-- ---------------------------------------------------------------------------
-- 4. replace_daily_report_allocation に p_stock を追加
-- ---------------------------------------------------------------------------
-- 本文は 20261021000000_add_daily_report_coverage.sql と同じ（作り置きの推定の置き換えだけ追加）。
-- 引数が増えるので旧シグネチャを消してから作り直す（オーバーロードを残さない）。
DROP FUNCTION IF EXISTS replace_daily_report_allocation(uuid, timestamptz, jsonb, jsonb, jsonb);

CREATE OR REPLACE FUNCTION replace_daily_report_allocation(
  p_tenant_id    uuid,
  p_computed_at  timestamptz,
  p_progress     jsonb,
  p_unallocated  jsonb,
  p_coverage     jsonb DEFAULT '[]'::jsonb,
  p_stock        jsonb DEFAULT '[]'::jsonb
)
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_current_computed_at  timestamptz;
  v_progress_count       integer;
  v_unallocated_count    integer;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('daily_report_allocation:' || p_tenant_id::text, 0)
  );

  SELECT r.computed_at INTO v_current_computed_at
    FROM daily_report_allocation_runs r
   WHERE r.tenant_id = p_tenant_id;

  IF FOUND AND v_current_computed_at > p_computed_at THEN
    RETURN 'stale';
  END IF;

  DELETE FROM order_process_progress
   WHERE tenant_id = p_tenant_id;

  DELETE FROM daily_report_unallocated_actuals
   WHERE tenant_id = p_tenant_id;

  DELETE FROM daily_report_stock_estimates
   WHERE tenant_id = p_tenant_id;

  INSERT INTO order_process_progress (
    tenant_id, order_id, process_routing_id,
    good_qty, first_actual_date, last_actual_date,
    status, completed_by, computed_at
  )
  SELECT
    p_tenant_id, p.order_id, p.process_routing_id,
    p.good_qty, p.first_actual_date, p.last_actual_date,
    p.status, p.completed_by, p_computed_at
  FROM jsonb_to_recordset(COALESCE(p_progress, '[]'::jsonb)) AS p(
    order_id            bigint,
    process_routing_id  bigint,
    good_qty            integer,
    first_actual_date   date,
    last_actual_date    date,
    status              text,
    completed_by        text
  )
  JOIN orders o
    ON o.id = p.order_id
   AND o.tenant_id = p_tenant_id
  JOIN process_routings r
    ON r.id = p.process_routing_id
   AND r.tenant_id = p_tenant_id;

  GET DIAGNOSTICS v_progress_count = ROW_COUNT;

  INSERT INTO daily_report_unallocated_actuals (
    tenant_id, entry_id, product_id, customer_id,
    process_name, work_date, qty, reason, computed_at
  )
  SELECT
    p_tenant_id, u.entry_id, u.product_id, c.id,
    u.process_name, u.work_date, u.qty, u.reason, p_computed_at
  FROM jsonb_to_recordset(COALESCE(p_unallocated, '[]'::jsonb)) AS u(
    entry_id      bigint,
    product_id    bigint,
    customer_id   bigint,
    process_name  text,
    work_date     date,
    qty           integer,
    reason        text
  )
  JOIN daily_report_entries e
    ON e.id = u.entry_id
   AND e.tenant_id = p_tenant_id
  JOIN products pr
    ON pr.id = u.product_id
   AND pr.tenant_id = p_tenant_id
  LEFT JOIN customers c
    ON c.id = u.customer_id
   AND c.tenant_id = p_tenant_id;

  GET DIAGNOSTICS v_unallocated_count = ROW_COUNT;

  INSERT INTO daily_report_stock_estimates (
    tenant_id, product_id, process_name, next_process_name,
    qty, last_movement_date, computed_at
  )
  SELECT
    p_tenant_id, s.product_id, s.process_name, s.next_process_name,
    s.qty, s.last_movement_date, p_computed_at
  FROM jsonb_to_recordset(COALESCE(p_stock, '[]'::jsonb)) AS s(
    product_id          bigint,
    process_name        text,
    next_process_name   text,
    qty                 integer,
    last_movement_date  date
  )
  JOIN products pr
    ON pr.id = s.product_id
   AND pr.tenant_id = p_tenant_id;

  INSERT INTO daily_report_allocation_runs (
    tenant_id, computed_at, progress_count, unallocated_count, coverage, updated_at
  )
  VALUES (
    p_tenant_id, p_computed_at, v_progress_count, v_unallocated_count,
    COALESCE(p_coverage, '[]'::jsonb), now()
  )
  ON CONFLICT (tenant_id) DO UPDATE SET
    computed_at       = EXCLUDED.computed_at,
    progress_count    = EXCLUDED.progress_count,
    unallocated_count = EXCLUDED.unallocated_count,
    coverage          = EXCLUDED.coverage,
    updated_at        = EXCLUDED.updated_at;

  RETURN 'replaced';
END;
$$;

REVOKE EXECUTE ON FUNCTION replace_daily_report_allocation(uuid, timestamptz, jsonb, jsonb, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION replace_daily_report_allocation(uuid, timestamptz, jsonb, jsonb, jsonb, jsonb)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 5. merge_products: 作り置きの指摘を引き継ぐ
-- ---------------------------------------------------------------------------
-- 本文は 20261016000000_add_merge_products.sql と同じ（3. の後に指摘の付け替えだけ追加）。シグネチャは同じ。
-- 指摘は製品単位で1件なので、残す製品に指摘が無いときだけ、統合される側の最新の指摘を引き継ぐ。
-- 引き継がなかった指摘は 4. の製品の削除の CASCADE で消える。作り置きの推定（daily_report_stock_estimates）は
-- 製品の削除の CASCADE で消え、次回の再計算で反映される。
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

  -- 日報の作り置きの指摘（#591）。updated_by・updated_at は指摘した人・日時のまま残す
  UPDATE daily_report_stock_feedback f
     SET product_id = p_keep_product_id
   WHERE f.id = (
           SELECT m.id
             FROM daily_report_stock_feedback m
            WHERE m.tenant_id = p_tenant_id
              AND m.product_id = ANY(v_merge_ids)
            ORDER BY m.updated_at DESC, m.id
            LIMIT 1
         )
     AND NOT EXISTS (
           SELECT 1
             FROM daily_report_stock_feedback k
            WHERE k.tenant_id = p_tenant_id
              AND k.product_id = p_keep_product_id
         );

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
