-- 承認依頼のアプリ内通知 (Issue #327)
-- order_handler が承認依頼を送信した際（draft→pending_approval）、president 向けに
-- notifications へ書き込めるようにする。

ALTER TABLE notifications DROP CONSTRAINT notifications_notif_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_notif_type_check
CHECK (notif_type IN (
  'no_product_match', 'downgrade_skipped', 'draft_conflict_skipped',
  'failed_encrypted', 'failed_image', 'non_order_email', 'customer_draft_created',
  'multi_order_suspected', 'approval_requested'
));

-- notifications への書き込みはこれまで cron/Service Role Key 経由に限定されていたが
-- （20260703000000_add_notifications.sql 参照）、承認依頼はユーザー操作（APIリクエスト）
-- 起点のため、ユーザーJWTクライアントからの書き込み経路を新設する。
--
-- order_approval_log (20260811000000_add_order_approval_log.sql) と同じ考え方で、
-- notif_type と source_table をこの用途に固定した WITH CHECK により、他のnotif_type
-- （PDF解析ログ等、cron専用）をユーザーJWT経由で偽装挿入できないようにする。
-- source_id（orders.id）の正当性については、is_tenant_member(tenant_id) チェックに加え、
-- アプリ層（POST /orders/{order_id}/request-approval）で常にログイン中テナントの
-- 注文からしか呼び出されないことで担保する。
CREATE POLICY "insert approval_requested from user jwt" ON notifications
  FOR INSERT
  WITH CHECK (
    is_tenant_member(tenant_id)
    AND notif_type = 'approval_requested'
    AND source_table = 'orders'
  );
