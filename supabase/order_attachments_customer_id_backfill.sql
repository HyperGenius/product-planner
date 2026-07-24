-- Issue #315: order_attachments.customer_id backfill 実行用スクリプト
-- Supabase SQL Editor 等で直接実行する一回限りのスクリプト（マイグレーション管理対象外）
-- 実行前に order_attachments_customer_id_check.sql で対象件数を確認しておくこと
--
-- 注文詳細画面で顧客を変更しても order_attachments.customer_id が追従しなかった
-- （PR で修正済み、Issue #315）ため、既存データを orders.customer_id に合わせて補正する。
-- order_id が NULL のステージング行（PDF解析待ちの添付）は同期先の注文がないため対象外。
--
-- 対象は現在の customer_id が draft 顧客（メール取込で自動生成された「不明な顧客」）
-- である行のみに限定する。実在の active 顧客（例: id=3 ヱトー株式会社）が
-- order_attachments からしか参照されていないケースは、注文との紐付けが別の理由で
-- ずれている可能性があり、誤って書き換えないよう本スクリプトの対象外とする。

begin;

update order_attachments oa
set customer_id = o.customer_id
from orders o, customers c
where oa.order_id = o.id
  and c.id = oa.customer_id
  and oa.customer_id is distinct from o.customer_id
  and c.status = 'draft';

-- 更新件数を確認してから commit / rollback を判断すること
commit;
