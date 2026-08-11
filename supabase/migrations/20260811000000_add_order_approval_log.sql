-- 承認ワークフローの操作主体を記録する監査ログ基盤 (Issue #326)
-- 共有端末での操作であっても、承認依頼送信・承認・却下の各操作を実行した
-- ユーザーIDと日時をアプリ層で記録し、ISO要件である承認プロセスの証跡を残す。

CREATE TABLE order_approval_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  order_id      bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  action        text NOT NULL CHECK (action IN ('request_approval', 'approve', 'reject')),
  actor_user_id uuid NOT NULL REFERENCES auth.users(id),
  reason        text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE order_approval_log ENABLE ROW LEVEL SECURITY;

-- CLAUDE.md の規約に従い is_tenant_member(tenant_id) を使用する。
-- 承認系エンドポイントはユーザーJWTクライアント経由で処理されるため
-- (routers/transaction/orders.py の get_supabase_client 依存)、
-- notifications と異なり INSERT もユーザーJWTから行う。
-- 閲覧は監査目的のため iso_officer / president / platform_admin に限定する
-- （order_handler は自身の操作ログであっても閲覧不可とし、監査ログとしての
--   独立性を保つ）。
CREATE POLICY "tenant isolation (select)" ON order_approval_log
  FOR SELECT
  USING (
    is_tenant_member(tenant_id)
    AND EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.tenant_id = order_approval_log.tenant_id
        AND om.user_id = auth.uid()
        AND om.role IN ('iso_officer', 'president', 'platform_admin')
    )
  );

CREATE POLICY "tenant isolation (insert)" ON order_approval_log
  FOR INSERT
  WITH CHECK (is_tenant_member(tenant_id) AND actor_user_id = auth.uid());

CREATE INDEX idx_order_approval_log_tenant_order ON order_approval_log (tenant_id, order_id, created_at DESC);
