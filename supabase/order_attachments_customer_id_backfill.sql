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

-- 1. order_id が設定済みの実添付行を orders.customer_id に合わせる
update order_attachments oa
set customer_id = o.customer_id
from orders o, customers c
where oa.order_id = o.id
  and c.id = oa.customer_id
  and oa.customer_id is distinct from o.customer_id
  and c.status = 'draft';

-- 2. order_id が NULL のステージング行（メール/PDF起票の1ソース）は
--    orders.source_attachment_id 経由で紐づく。同じソースから生成された
--    全ての注文の顧客が一致している場合に限り同期する
--    （1ソース:N受注で顧客がまだ割れている場合は判断できないため対象外）
with source_customer as (
  select source_attachment_id, min(customer_id) as customer_id
  from orders
  where source_attachment_id is not null
  group by source_attachment_id
  having count(distinct customer_id) = 1
)
update order_attachments oa
set customer_id = sc.customer_id
from source_customer sc, customers c
where oa.id = sc.source_attachment_id
  and oa.order_id is null
  and c.id = oa.customer_id
  and c.status = 'draft'
  and oa.customer_id is distinct from sc.customer_id;

-- 更新件数を確認してから commit / rollback を判断すること
commit;
