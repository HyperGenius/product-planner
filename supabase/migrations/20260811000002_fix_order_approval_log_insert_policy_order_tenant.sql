-- order_approval_log の INSERT ポリシー強化 (Copilotレビュー指摘対応)
-- 従来は is_tenant_member(tenant_id) と actor_user_id = auth.uid() のみを検証しており、
-- order_id が実際にその tenant_id の orders に属するかまでは検証していなかった。
-- そのため同一テナントの正規メンバーが、他テナントの order_id（連番のbigintで推測可能）を
-- 指定して監査ログに偽の行を挿入し、監査ログの整合性を汚染できてしまう余地があった。
-- order_id が指定した tenant_id の orders に属することを WITH CHECK で追加検証する。

DROP POLICY "tenant isolation (insert)" ON order_approval_log;

CREATE POLICY "tenant isolation (insert)" ON order_approval_log
  FOR INSERT
  WITH CHECK (
    is_tenant_member(tenant_id)
    AND actor_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_approval_log.order_id
        AND o.tenant_id = order_approval_log.tenant_id
    )
  );
