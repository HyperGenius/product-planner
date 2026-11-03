-- 作り置きの引き当ての引き当て元（日報の明細）を残す (Issue #624 の改善)
--
-- 引き当て (daily_report_stock_assignments) は「製品・工程・数」しか持たず、どの日報の明細（日報の商品名・顧客先・
-- 加工日）から充てたかが画面で確かめられなかった。割り付けの再計算で充当した明細を、引き当て (受注・工程) ごとに
-- 結果として残す。割り付けの他の結果と同じく差分更新せず、再計算のたびにテナント単位で置き換える。
--
-- 引き当てを取り消す・登録し直した後は、次の再計算まで古い内訳が残る（API は現存する引き当ての (受注, 工程) に
-- 合う行だけを返す）。受注・明細を消したら一緒に消す。

CREATE TABLE daily_report_stock_assignment_sources (
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  order_id      bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  process_name  text NOT NULL,
  entry_id      bigint NOT NULL REFERENCES daily_report_entries(id) ON DELETE CASCADE,
  work_date     date NOT NULL,
  qty           integer NOT NULL CHECK (qty > 0),
  computed_at   timestamptz NOT NULL,
  PRIMARY KEY (order_id, process_name, entry_id)
);

CREATE INDEX idx_daily_report_stock_assignment_sources_tenant
  ON daily_report_stock_assignment_sources (tenant_id);

ALTER TABLE daily_report_stock_assignment_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members can view daily_report_stock_assignment_sources"
  ON daily_report_stock_assignment_sources FOR SELECT
  USING (is_tenant_member(tenant_id));

-- 書き込みは replace_daily_report_allocation（service role）のみ

-- ---------------------------------------------------------------------------
-- replace_daily_report_allocation に p_stock_sources を追加
-- ---------------------------------------------------------------------------
-- 本文は 20261029000000_add_daily_report_stock_estimates.sql と同じ（引き当て元の置き換えだけ追加）。
-- 引数が増えるので旧シグネチャを消してから作り直す（オーバーロードを残さない）。
DROP FUNCTION IF EXISTS replace_daily_report_allocation(uuid, timestamptz, jsonb, jsonb, jsonb, jsonb);

CREATE OR REPLACE FUNCTION replace_daily_report_allocation(
  p_tenant_id      uuid,
  p_computed_at    timestamptz,
  p_progress       jsonb,
  p_unallocated    jsonb,
  p_coverage       jsonb DEFAULT '[]'::jsonb,
  p_stock          jsonb DEFAULT '[]'::jsonb,
  p_stock_sources  jsonb DEFAULT '[]'::jsonb
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

  DELETE FROM daily_report_stock_assignment_sources
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

  INSERT INTO daily_report_stock_assignment_sources (
    tenant_id, order_id, process_name, entry_id, work_date, qty, computed_at
  )
  SELECT
    p_tenant_id, ss.order_id, ss.process_name, ss.entry_id, ss.work_date, ss.qty, p_computed_at
  FROM jsonb_to_recordset(COALESCE(p_stock_sources, '[]'::jsonb)) AS ss(
    order_id      bigint,
    process_name  text,
    entry_id      bigint,
    work_date     date,
    qty           integer
  )
  JOIN orders o
    ON o.id = ss.order_id
   AND o.tenant_id = p_tenant_id
  JOIN daily_report_entries e
    ON e.id = ss.entry_id
   AND e.tenant_id = p_tenant_id;

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

REVOKE EXECUTE ON FUNCTION replace_daily_report_allocation(uuid, timestamptz, jsonb, jsonb, jsonb, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION replace_daily_report_allocation(uuid, timestamptz, jsonb, jsonb, jsonb, jsonb, jsonb)
  TO service_role;
