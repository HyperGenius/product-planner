-- Issue #315: order_attachments.customer_id backfill 事前確認用スクリプト
-- Supabase SQL Editor 等で直接実行する一回限りのスクリプト（マイグレーション管理対象外）
--
-- 対象は「メール取込で自動生成された下書き顧客 (customers.status = 'draft')」への
-- 古い参照のみ。実在の active 顧客（例: id=3 ヱトー株式会社）が order_attachments
-- からしか参照されていないケースは、注文との紐付けが別の理由でずれている可能性があり
-- 本スクリプトの対象外とする（誤って実顧客のデータを書き換えないため）。
--
-- 1. orders.customer_id と食い違っている order_attachments 行のうち、
--    現在の customer_id が draft 顧客であるものを確認する
-- 2. order_attachments からしか参照されていない draft 顧客
--    （バックフィル後に削除可能になる想定の顧客）を確認する

-- 1. orders.customer_id と食い違っている order_attachments 行（draft顧客のみ）
select oa.id, oa.order_id, oa.customer_id as stale_customer_id, o.customer_id as correct_customer_id
from order_attachments oa
join orders o on o.id = oa.order_id
join customers c on c.id = oa.customer_id
where oa.customer_id is distinct from o.customer_id
  and c.status = 'draft';

-- 2. order_attachments からしか参照されていない draft 顧客
select c.id, c.name, c.status
from customers c
where c.status = 'draft'
  and exists (select 1 from order_attachments oa where oa.customer_id = c.id)
  and not exists (select 1 from orders o where o.customer_id = c.id);
