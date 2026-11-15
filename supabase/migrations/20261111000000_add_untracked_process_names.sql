-- 日報で追わない工程 (Issue #681, Epic #679)
--
-- 検査など、日報に書かない（まだ取り込めていない）工程を工程名の単位で設定する。設定した工程は
-- 日報の割り付け（services/daily_report_allocator.py）で進捗の行（order_process_progress）を作らない。
-- これでガント・受注詳細では「計画のみ」になって遅れに見えず、送品の候補「最終工程が完了」も
-- 日報で追う最後の工程で判定される。
--
-- 1. untracked_process_names: 工程名（テナント共通）の設定。製品をまたいで同じ名前の工程に効き、
--    新しい製品の工程ルートにも自動で効く（日報の工程の別名辞書 process_name_aliases も工程名の単位）。
--    日報の名寄せの「対象外」（daily_report_ignored_names）は日報の表記の側の設定で、名寄せの途中の工程と
--    区別できないので使わない。書き込めるロール（社長・プラットフォーム管理者）は API で絞る。
--    工程名は前後の空白を除いて保存し（API が str.strip() する）、工程ルートの process_name の前後の空白を
--    除いた値と比べる。
--
-- 2. 未割当の理由に untracked_process（日報で追わない工程に実績が来た）を追加する。割り付けずに残し、
--    照合状況に出す（検査の日報を取り込み始めたときに、設定を外す合図にする）。工程ルートの有無
--    （no_routing_process）より先に判定する。既存の行は次の再計算（cron）で置き換わる。

-- ---------------------------------------------------------------------------
-- 1. 日報で追わない工程
-- ---------------------------------------------------------------------------
CREATE TABLE untracked_process_names (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  process_name  text NOT NULL CHECK (btrim(process_name) <> ''),
  created_by    uuid NOT NULL REFERENCES auth.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT untracked_process_names_tenant_id_process_name_key UNIQUE (tenant_id, process_name)
);

ALTER TABLE untracked_process_names ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members can view untracked process names" ON untracked_process_names
  FOR SELECT
  USING (is_tenant_member(tenant_id));

CREATE POLICY "tenant members can insert untracked process names" ON untracked_process_names
  FOR INSERT
  WITH CHECK (is_tenant_member(tenant_id) AND created_by = auth.uid());

CREATE POLICY "tenant members can delete untracked process names" ON untracked_process_names
  FOR DELETE
  USING (is_tenant_member(tenant_id));

-- ---------------------------------------------------------------------------
-- 2. 未割当の理由
-- ---------------------------------------------------------------------------
ALTER TABLE daily_report_unallocated_actuals
  DROP CONSTRAINT daily_report_unallocated_actuals_reason_check;

ALTER TABLE daily_report_unallocated_actuals
  ADD CONSTRAINT daily_report_unallocated_actuals_reason_check
  CHECK (reason IN (
    'untracked_process', 'no_routing_process', 'no_candidate_order', 'before_order_date',
    'exceeds_order_qty', 'no_work_date'
  ));
