-- Issue #315: order_attachments.customer_id backfill 事前確認用スクリプト
-- Supabase SQL Editor 等で直接実行する一回限りのスクリプト（マイグレーション管理対象外）
--
-- 1. orders.customer_id と食い違っている order_attachments 行を確認する
-- 2. order_attachments からしか参照されていない顧客（バックフィル後に削除可能になる想定の顧客）を確認する

-- 1. orders.customer_id と食い違っている order_attachments 行
select oa.id, oa.order_id, oa.customer_id as stale_customer_id, o.customer_id as correct_customer_id
from order_attachments oa
join orders o on o.id = oa.order_id
where oa.customer_id is distinct from o.customer_id;

-- 2. order_attachments からしか参照されていない顧客
select c.id, c.name, c.status
from customers c
where exists (select 1 from order_attachments oa where oa.customer_id = c.id)
  and not exists (select 1 from orders o where o.customer_id = c.id);
