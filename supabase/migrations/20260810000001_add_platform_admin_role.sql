-- ==========================================
-- platform_admin ロールの追加
--
-- 閲覧全般・メンバー管理・設定サポート等を担うプラットフォーム運営側の
-- サポートロール。ただし承認操作（受注承認・工程確定等）は含めない。
-- ==========================================

alter table organization_members
  drop constraint organization_members_role_check;

alter table organization_members
  add constraint organization_members_role_check
  check (role in ('president', 'iso_officer', 'order_handler', 'platform_admin'));
