-- order_attachments のRLSポリシー修正
--
-- 従来のポリシーは auth.jwt() ->> 'tenant_id' クレームを直接参照していたが、
-- このクレームは実際には発行されておらず、他の全テーブルが使っている
-- is_tenant_member(tenant_id)（organization_members テーブルでの所属確認）
-- とは異なる方式だった。そのため通常のユーザーJWTクライアントでは
-- order_attachments に対するSELECT/INSERTが常にRLS違反になり、
-- POST /orders/{id}/split 実装時にサービスロールキーでの回避が
-- 必要になっていた（本来はこのポリシー自体の不整合が原因）。
--
-- 他テーブルと同じ is_tenant_member(tenant_id) に統一し、通常の
-- ユーザークライアントで order_attachments を扱えるようにする。

drop policy "tenant isolation" on order_attachments;

create policy "Tenant isolation for order_attachments"
  on order_attachments
  for all
  using ( is_tenant_member(tenant_id) )
  with check ( is_tenant_member(tenant_id) );
