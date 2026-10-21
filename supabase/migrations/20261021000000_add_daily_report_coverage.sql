-- 日報の照合状況の画面 (Issue #542, 親Issue #485)
--
-- 1. 未割当の理由に no_routing_process（製品の工程ルートにその工程名が無い）を追加する。
--    これまでは no_candidate_order に含めていたが、工程の棚卸しで聞くこと（実際の工程順）と
--    受注が無いときに聞くこと（見込み生産・登録漏れ）が違うので分ける。割り付け
--    （services/daily_report_allocator.py）は工程ルートの有無を受注の有無より先に判定する。
--    既存の行は次の再計算（cron）で置き換わる。
--
-- 2. daily_report_allocation_runs に coverage（加工月ごとの照合済み・未照合の数量）を追加する。
--    照合状況のサマリ（割り付け済み・未割当・未照合の内訳）を期間で絞り込んで出すため、割り付けと
--    同じ時点の集計を同じトランザクションで保存する。要素は
--    {"work_month": "YYYY-MM-01" | null, "matched_rows", "matched_qty", "unmatched_rows", "unmatched_qty"}。
--    数量は「明細×マスタの工程名」単位（未割当と同じ）。割り付け済みの数量は保存せず、
--    matched_qty から未割当の数量を引いて求める。
--
-- 3. RPC replace_daily_report_allocation に p_coverage を追加する（DEFAULT 付きなので、
--    このマイグレーションの後で古いバックエンドが4引数で呼んでも動く）。

-- ---------------------------------------------------------------------------
-- 1. 未割当の理由
-- ---------------------------------------------------------------------------
ALTER TABLE daily_report_unallocated_actuals
  DROP CONSTRAINT daily_report_unallocated_actuals_reason_check;

ALTER TABLE daily_report_unallocated_actuals
  ADD CONSTRAINT daily_report_unallocated_actuals_reason_check
  CHECK (reason IN (
    'no_routing_process', 'no_candidate_order', 'before_order_date',
    'exceeds_order_qty', 'no_work_date'
  ));

-- ---------------------------------------------------------------------------
-- 2. 加工月ごとの照合状況
-- ---------------------------------------------------------------------------
ALTER TABLE daily_report_allocation_runs
  ADD COLUMN coverage jsonb NOT NULL DEFAULT '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- 3. replace_daily_report_allocation に p_coverage を追加
-- ---------------------------------------------------------------------------
-- 本文は 20261006000000_add_daily_report_allocation.sql と同じ（runs への coverage の書き込みだけ追加）。
-- 引数が増えるので旧シグネチャを消してから作り直す（オーバーロードを残さない）。
DROP FUNCTION IF EXISTS replace_daily_report_allocation(uuid, timestamptz, jsonb, jsonb);

CREATE OR REPLACE FUNCTION replace_daily_report_allocation(
  p_tenant_id    uuid,
  p_computed_at  timestamptz,
  p_progress     jsonb,
  p_unallocated  jsonb,
  p_coverage     jsonb DEFAULT '[]'::jsonb
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

REVOKE EXECUTE ON FUNCTION replace_daily_report_allocation(uuid, timestamptz, jsonb, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION replace_daily_report_allocation(uuid, timestamptz, jsonb, jsonb, jsonb)
  TO service_role;
