-- Allow 'customer_draft_created' as a notif_type (Issue #263)
-- メール/PDF起票で顧客が特定できず下書き顧客を自動作成した際、担当者向けに記録する通知。
alter table notifications drop constraint notifications_notif_type_check;

alter table notifications
add constraint notifications_notif_type_check
check (notif_type in (
  'no_product_match', 'downgrade_skipped', 'draft_conflict_skipped',
  'failed_encrypted', 'failed_image', 'non_order_email', 'customer_draft_created'
));
