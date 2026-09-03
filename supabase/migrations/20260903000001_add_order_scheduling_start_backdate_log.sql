-- ==========================================
-- 作業開始日の遡り設定（過去日）監査ログ (Issue #372)
--
-- president / platform_admin が受注の scheduling_start_date（作業開始日）を
-- 過去日に設定した操作の証跡を残す（起票前に着手してしまったケースの救済措置）。
-- 「誰が・いつ・どの受注に・どの過去日を設定したか」を追記専用で記録する。
--
-- order_approval_log は承認ワークフロー専用のため混在させず、専用テーブルとする。
-- ==========================================

CREATE TABLE order_scheduling_start_backdate_log (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id),
  order_id              bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  scheduling_start_date date NOT NULL,
  actor_user_id         uuid NOT NULL REFERENCES auth.users(id),
  context               text NOT NULL CHECK (context IN ('create', 'update')),
  created_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE order_scheduling_start_backdate_log IS
  '作業開始日を過去日に設定した操作の監査ログ（Issue #372。追記専用）';

ALTER TABLE order_scheduling_start_backdate_log ENABLE ROW LEVEL SECURITY;

-- 閲覧は監査目的のため iso_officer / president / platform_admin に限定する
-- （order_approval_log と同じ方針）。
CREATE POLICY "tenant isolation (select)" ON order_scheduling_start_backdate_log
  FOR SELECT
  USING (
    is_tenant_member(tenant_id)
    AND EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.tenant_id = order_scheduling_start_backdate_log.tenant_id
        AND om.user_id = auth.uid()
        AND om.role IN ('iso_officer', 'president', 'platform_admin')
    )
  );

-- 書き込みは操作者本人（president / platform_admin）のユーザーJWTから行う。
-- INSERT 後の RETURNING で SELECT ポリシーが評価されるのを避けるため、
-- リポジトリ側は returning=minimal で INSERT する。
--
-- 監査証跡の偽造耐性のため、WITH CHECK で以下も検証する
-- （order_approval_log の INSERT ポリシー強化と同種の対策）:
--   * order_id が指定 tenant_id の orders に属すること（連番bigintの推測による偽装を防ぐ）
--   * actor（＝auth.uid()）のロールが president / platform_admin であること
--     （過去日設定はこの2ロールのみ許可するアプリ層ルールを RLS でも担保する）
CREATE POLICY "tenant isolation (insert)" ON order_scheduling_start_backdate_log
  FOR INSERT
  WITH CHECK (
    is_tenant_member(tenant_id)
    AND actor_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_scheduling_start_backdate_log.order_id
        AND o.tenant_id = order_scheduling_start_backdate_log.tenant_id
    )
    AND EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.tenant_id = order_scheduling_start_backdate_log.tenant_id
        AND om.user_id = auth.uid()
        AND om.role IN ('president', 'platform_admin')
    )
  );

CREATE INDEX idx_order_sched_start_backdate_log_tenant_order
  ON order_scheduling_start_backdate_log (tenant_id, order_id, created_at DESC);
