-- 日報の実績の受注への割り付けと進捗 (Issue #490, 親Issue #485)
--
-- 照合済みの日報明細（daily_report_entries ＋ 名寄せ #488）の良品数を、(製品, マスタの工程名) 単位で
-- 確定済み・生産中の受注に納期の早い順で充当し、受注×工程ごとの進捗を保存する。
-- 計算は services/daily_report_allocator.py（純粋関数）で行い、ここには結果だけを保存する。
--
-- 割り付け・進捗は差分更新せず、**テナント単位で毎回全量を再計算して丸ごと置き換える**（Epic #485 の方針）。
-- 辞書の修正・受注の追加・明細の置き換えがそのまま反映される。置き換えは RPC
-- replace_daily_report_allocation で1トランザクションにまとめ、途中で失敗しても進捗が空にならないようにする。
--
-- 書き込みは cron（service role）のみ。RLS を有効にしたうえで SELECT ポリシーだけを作る
-- （daily_report_entries と同じ方針、20261003000000_add_daily_report_entries.sql 参照）。

-- ---------------------------------------------------------------------------
-- daily_report_allocation_runs: テナントごとの最終計算
-- ---------------------------------------------------------------------------
-- computed_at は計算に使うデータを読み始めた時刻。これより古い計算結果では置き換えない
-- （cron の実行が重なったときに、後から終わった古い計算で上書きしないため）。
CREATE TABLE daily_report_allocation_runs (
  tenant_id          uuid PRIMARY KEY REFERENCES tenants(id),
  computed_at        timestamptz NOT NULL,
  progress_count     integer NOT NULL DEFAULT 0 CHECK (progress_count >= 0),
  unallocated_count  integer NOT NULL DEFAULT 0 CHECK (unallocated_count >= 0),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE daily_report_allocation_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members can view daily report allocation runs" ON daily_report_allocation_runs
  FOR SELECT
  USING (is_tenant_member(tenant_id));

-- ---------------------------------------------------------------------------
-- order_process_progress: 受注×工程ごとの進捗
-- ---------------------------------------------------------------------------
-- 対象は割り付けの候補になる受注（status が confirmed / in_progress）の全工程。実績の無い工程も
-- not_started で持つ（受注が対象外になる＝出荷済み等になると次の再計算で行が消える）。
--   good_qty           割り付けた良品数（受注数量が上限。あふれた分は次の受注か未割当へ）
--   first/last_actual_date  割り付けた明細の加工日の最小・最大
--   status             not_started / in_progress / completed
--   completed_by       completed の根拠。quantity＝良品数が受注数量以上、
--                      later_process＝後の工程（sequence_order が大きい工程）に実績がある
CREATE TABLE order_process_progress (
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  order_id            bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  process_routing_id  bigint NOT NULL REFERENCES process_routings(id) ON DELETE CASCADE,
  good_qty            integer NOT NULL DEFAULT 0 CHECK (good_qty >= 0),
  first_actual_date   date,
  last_actual_date    date,
  status              text NOT NULL
    CHECK (status IN ('not_started', 'in_progress', 'completed')),
  completed_by        text
    CHECK (completed_by IN ('quantity', 'later_process')),
  computed_at         timestamptz NOT NULL,
  PRIMARY KEY (order_id, process_routing_id),
  CONSTRAINT order_process_progress_status_completed_by_check
    CHECK ((status = 'completed') = (completed_by IS NOT NULL))
);

ALTER TABLE order_process_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members can view order process progress" ON order_process_progress
  FOR SELECT
  USING (is_tenant_member(tenant_id));

CREATE INDEX idx_order_process_progress_tenant
  ON order_process_progress (tenant_id);

CREATE INDEX idx_order_process_progress_routing
  ON order_process_progress (process_routing_id);

-- ---------------------------------------------------------------------------
-- daily_report_unallocated_actuals: どの受注にも充当できなかった実績
-- ---------------------------------------------------------------------------
-- 明細1行×マスタの工程名ごと（「カシメ、仕上げ加工」は工程ごとに1行）。受注の登録漏れ・
-- 見込み生産（在庫の先行生産）などの発見に使う。照合できなかった明細（#488 の未照合）は含めない。
--   no_candidate_order  同じ製品（顧客が照合できていれば同じ顧客）の確定済み・生産中の受注で、
--                       その工程を持つものが無い
--   before_order_date   候補の受注はあるが、加工日がどの候補の受注日（order_date の JST 暦日）よりも前
--   exceeds_order_qty   候補の受注の数量をすべて満たしてもあふれた
--   no_work_date        加工日が読めない明細（受注日と比べられないので充当しない）
CREATE TABLE daily_report_unallocated_actuals (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  entry_id       bigint NOT NULL REFERENCES daily_report_entries(id) ON DELETE CASCADE,
  product_id     bigint NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  customer_id    bigint REFERENCES customers(id) ON DELETE SET NULL,
  process_name   text NOT NULL,
  work_date      date,
  qty            integer NOT NULL CHECK (qty > 0),
  reason         text NOT NULL
    CHECK (reason IN ('no_candidate_order', 'before_order_date', 'exceeds_order_qty', 'no_work_date')),
  computed_at    timestamptz NOT NULL
);

ALTER TABLE daily_report_unallocated_actuals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members can view daily report unallocated actuals" ON daily_report_unallocated_actuals
  FOR SELECT
  USING (is_tenant_member(tenant_id));

CREATE INDEX idx_daily_report_unallocated_actuals_tenant_work_date
  ON daily_report_unallocated_actuals (tenant_id, work_date);

CREATE INDEX idx_daily_report_unallocated_actuals_entry
  ON daily_report_unallocated_actuals (entry_id);

-- ---------------------------------------------------------------------------
-- replace_daily_report_allocation: テナントの割り付け結果を丸ごと置き換える
-- ---------------------------------------------------------------------------
-- 古い結果の DELETE と新しい結果の INSERT を1トランザクションで行う。p_computed_at が
-- 現在載っている結果の computed_at より古ければ何もせず 'stale' を返す（それ以外は 'replaced'）。
-- 同じテナントの再計算が並行しても順序が崩れないよう、テナントで advisory lock を取る。
--
-- 計算に使ったデータを読んだ後で受注・工程・明細が削除されている場合があるので、
-- このテナントに現存する行に結合して INSERT する（外部キー違反で全体を失敗させない。
-- 他テナントの ID が混ざっても入らない）。
--
-- cron（service role）からのみ呼ぶ。p_tenant_id は呼び出し側が daily_report_sheets 等の行から
-- 解決した値。
CREATE OR REPLACE FUNCTION replace_daily_report_allocation(
  p_tenant_id    uuid,
  p_computed_at  timestamptz,
  p_progress     jsonb,
  p_unallocated  jsonb
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
    tenant_id, computed_at, progress_count, unallocated_count, updated_at
  )
  VALUES (
    p_tenant_id, p_computed_at, v_progress_count, v_unallocated_count, now()
  )
  ON CONFLICT (tenant_id) DO UPDATE SET
    computed_at       = EXCLUDED.computed_at,
    progress_count    = EXCLUDED.progress_count,
    unallocated_count = EXCLUDED.unallocated_count,
    updated_at        = EXCLUDED.updated_at;

  RETURN 'replaced';
END;
$$;

-- SECURITY INVOKER なのでユーザー JWT から呼んでも RLS（書き込みポリシー無し）で弾かれるが、
-- service role 専用であることを明示するため実行権限も絞る。
REVOKE EXECUTE ON FUNCTION replace_daily_report_allocation(uuid, timestamptz, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION replace_daily_report_allocation(uuid, timestamptz, jsonb, jsonb)
  TO service_role;
