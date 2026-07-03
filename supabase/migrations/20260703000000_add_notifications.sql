-- 自動処理パイプライン（PDF解析・メール抽出）のログを担当者に可視化する通知機能 (Issue #254)
-- order_parse_log / order_attachments.parse_status は詳細の一次情報として残したまま、
-- notifications は「担当者に見せる通知」専用の薄いテーブルとして横断的に記録する。

CREATE TABLE notifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  notif_type   text NOT NULL CHECK (notif_type IN (
                 'no_product_match', 'downgrade_skipped', 'draft_conflict_skipped',
                 'failed_encrypted', 'failed_image', 'non_order_email'
               )),
  source_table text NOT NULL,   -- 'order_parse_log' | 'order_attachments' | 'gmail_message'
  source_id    text,            -- 参照元IDの型がuuid/bigint/文字列と混在するためtext
  detail       jsonb,
  read_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN notifications.notif_type IS
  'order_parse_log.reason とは別語彙。notifications はPDF解析ログ・添付失敗・メール抽出結果を'
  '横断集約する通知専用テーブルであり、order_parse_log の1:1ミラーではないため。';

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- CLAUDE.md の規約に従い is_tenant_member(tenant_id) を使用する。
-- (order_parse_log の "auth.jwt() ->> 'tenant_id'" ポリシーは organization_members を
--  経由しないため実際のJWTクレームと一致せず機能しない。本テーブルでは追随しない)
CREATE POLICY "tenant isolation" ON notifications
  FOR ALL
  USING (is_tenant_member(tenant_id))
  WITH CHECK (is_tenant_member(tenant_id));

CREATE INDEX idx_notifications_tenant_unread ON notifications (tenant_id, read_at, created_at DESC);
