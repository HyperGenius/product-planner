-- 日報の作り置きを受注へ手で引き当てる (Issue #624, 親Issue #485)
--
-- 割り付け（#490）は加工日が受注日より前の実績を充当しないので、作り置き（#591）から出した受注は日報の上で
-- 進捗が付かない。日報に後の工程が出てこない製品では、作り置きの推定からも減らない。
-- 「この受注には、この工程まで済んだ作り置きを何個充てた」を受注担当者が登録し、割り付けの再計算
-- （cron `compute-daily-report-progress`）で、通常の割り付けの後に未割当に残った同じ製品・同じ工程の実績を
-- 顧客・受注日を問わず充当する。
-- 引き当てた分は割り付けの充当として作り置きの推定から差し引かれる。
--
--   process_name  受注の製品の工程ルートにある工程名（マスタの工程名）。この工程まで済んだ作り置きを充てた
--   qty           充てた数（受注数量以下は API で確かめる）
--   assigned_on   引き当てた日（JST 暦日）。この日以前の加工日の実績だけを充てる
--
-- 1受注1工程につき1件（登録し直すと上書き）。受注を消したら一緒に消す。
-- 書き込めるロールの制限は API 側（別名辞書・作り置きの指摘と同じ）。updated_by は auth.uid() と一致させる。
-- 割り付けの再計算は service role で読む。

CREATE TABLE daily_report_stock_assignments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  order_id      bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  process_name  text NOT NULL CHECK (btrim(process_name) <> ''),
  qty           integer NOT NULL CHECK (qty > 0),
  assigned_on   date NOT NULL,
  note          text,
  updated_by    uuid NOT NULL REFERENCES auth.users(id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT daily_report_stock_assignments_order_process_key UNIQUE (order_id, process_name)
);

CREATE INDEX idx_daily_report_stock_assignments_tenant
  ON daily_report_stock_assignments (tenant_id);

ALTER TABLE daily_report_stock_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members can view daily_report_stock_assignments"
  ON daily_report_stock_assignments FOR SELECT
  USING (is_tenant_member(tenant_id));

CREATE POLICY "tenant members can insert daily_report_stock_assignments"
  ON daily_report_stock_assignments FOR INSERT
  WITH CHECK (is_tenant_member(tenant_id) AND updated_by = auth.uid());

CREATE POLICY "tenant members can update daily_report_stock_assignments"
  ON daily_report_stock_assignments FOR UPDATE
  USING (is_tenant_member(tenant_id))
  WITH CHECK (is_tenant_member(tenant_id) AND updated_by = auth.uid());

CREATE POLICY "tenant members can delete daily_report_stock_assignments"
  ON daily_report_stock_assignments FOR DELETE
  USING (is_tenant_member(tenant_id));

-- updated_at は API が登録・上書きのたびに書く（作り置きの指摘と同じく set_updated_at() は付けない）
