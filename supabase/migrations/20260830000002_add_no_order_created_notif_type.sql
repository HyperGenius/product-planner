-- パース成功・起票0件の可視化 (Issue #357)
-- 自動抽出は成功したが全明細が既存注文と重複（skipped_no_change）し、order が
-- 1件も生成されず parse_log も通知も残らないケースを可視化するため、
-- notif_type に 'no_order_created' を追加する。

ALTER TABLE notifications DROP CONSTRAINT notifications_notif_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_notif_type_check
CHECK (notif_type IN (
  'no_product_match', 'downgrade_skipped', 'draft_conflict_skipped',
  'failed_encrypted', 'failed_image', 'non_order_email', 'customer_draft_created',
  'multi_order_suspected', 'approval_requested', 'no_order_created'
));
