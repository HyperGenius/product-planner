-- ==========================================
-- 既存受注のシミュレーション結果（工程スケジュール）を保存する
--
-- POST /orders/{id}/simulate と cron の自動起票のシミュレーションは dry_run のため、
-- production_schedules に工程が残らず、受注詳細を開き直すとシミュ納期（orders.simulated_deadline）
-- しか分からなかった。シミュ実行時のレスポンス（回答納期・希望納期に間に合うか・工程ごとの
-- 開始/終了・設備名）をスナップショットとして1受注1行で保存し、受注詳細で表示する。
--
-- orders の列にしないのは、受注一覧（GET /orders）が select("*") で全列を返すため
-- （一覧に工程の配列を載せない）。
--
-- 陳腐化の扱い: 製品・数量・希望納期・作業開始日の編集で orders.simulated_deadline /
-- is_scheduled はクリアされるが、この行は消さない。参照 API が受注の
-- is_scheduled かつ simulated_deadline ありのときだけ返すことで、シミュ納期と同じ寿命にする。
-- ==========================================

CREATE TABLE order_simulation_results (
  order_id     bigint PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- OrderSimulateResponse と同じ形（calculated_deadline / is_feasible / process_schedules）
  result       jsonb NOT NULL,
  simulated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE order_simulation_results IS
  '既存受注のシミュレーション（dry_run）結果のスナップショット。1受注1行で再シミュ時に上書きする。'
  '受注の is_scheduled かつ simulated_deadline ありのときだけ有効とみなす。';

ALTER TABLE order_simulation_results ENABLE ROW LEVEL SECURITY;

-- 手動シミュはユーザー JWT で upsert する（INSERT ... ON CONFLICT DO UPDATE のため
-- SELECT / INSERT / UPDATE の3つが要る）。cron の自動シミュは service role で書く。
-- order_id が指定 tenant_id の orders に属することを WITH CHECK で検証する。
CREATE POLICY "tenant isolation (select)" ON order_simulation_results
  FOR SELECT
  USING (is_tenant_member(tenant_id));

CREATE POLICY "tenant isolation (insert)" ON order_simulation_results
  FOR INSERT
  WITH CHECK (
    is_tenant_member(tenant_id)
    AND EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_simulation_results.order_id
        AND o.tenant_id = order_simulation_results.tenant_id
    )
  );

CREATE POLICY "tenant isolation (update)" ON order_simulation_results
  FOR UPDATE
  USING (is_tenant_member(tenant_id))
  WITH CHECK (
    is_tenant_member(tenant_id)
    AND EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_simulation_results.order_id
        AND o.tenant_id = order_simulation_results.tenant_id
    )
  );
