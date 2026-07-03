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
--
-- notifications への書き込み（INSERT/UPDATE）は cron エンドポイント
-- (parse-order-pdfs, gmail-poll) と PATCH /notifications/read から常に
-- Service Role Key の admin_client 経由（RLSバイパス）で行われ、
-- ユーザーJWTクライアントから直接書き込む経路は存在しない。
-- そのため認証ユーザーには SELECT のみ許可し、他テナントのnotifications行を
-- 経由した情報漏えい（source_id改ざんによる他テナント添付ファイルの署名付きURL取得等）
-- のリスクを避けるため INSERT/UPDATE/DELETE のポリシーは設けない（デフォルト拒否）。
CREATE POLICY "tenant isolation (select)" ON notifications
  FOR SELECT
  USING (is_tenant_member(tenant_id));

CREATE INDEX idx_notifications_tenant_unread ON notifications (tenant_id, read_at, created_at DESC);
