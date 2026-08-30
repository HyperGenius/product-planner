-- テナント指定で未確定の工程 (process_routings.is_confirmed = false) を一括承認するスクリプト
-- Supabase SQL Editor / supabase db query で直接実行する運用スクリプト（マイグレーション管理対象外）
--
-- 背景:
--   president と調整し、現在登録されている工程は一旦すべて承認済みとし、
--   ガントチャート等で不備が見つかった場合に個別修正する方針で合意したため。
--   （工程確定は通常 PATCH /process-routings/{id} を president 権限で行うが、
--     件数が多いため本スクリプトでまとめて反映する）
--
-- 実行方法:
--   1. 下の 4 箇所（確認用 2 クエリ + UPDATE + 結果確認）の
--      'REPLACE_WITH_TENANT_UUID' を対象テナントの UUID に置き換える
--   2. まず「確認用クエリ」で対象件数・承認者を確認する
--   3. 問題なければ begin ～ commit のブロックを実行する
--
-- 注: Supabase SQL Editor は psql メタコマンド（\set 等）を解釈しないため、
--     tenant_id は各クエリ内の params CTE にリテラルで埋め込む方式にしている。

-- ============================================================
-- 確認用クエリ（実行しても更新は発生しない）
-- ============================================================

-- 対象となる未確定工程の件数と、紐づく製品数
with params as (
  select 'REPLACE_WITH_TENANT_UUID'::uuid as tenant_id
)
select
  count(*)                       as unconfirmed_routings,
  count(distinct pr.product_id)  as affected_products
from process_routings pr, params
where pr.tenant_id = params.tenant_id
  and pr.is_confirmed = false;

-- confirmed_by に設定される president（同テナントの president のうち最古の登録者）
with params as (
  select 'REPLACE_WITH_TENANT_UUID'::uuid as tenant_id
)
select om.user_id as president_user_id, om.role, om.created_at
from organization_members om, params
where om.tenant_id = params.tenant_id
  and om.role = 'president'
order by om.created_at asc
limit 1;

-- ============================================================
-- 一括承認（トランザクション）
-- ============================================================
begin;

with params as (
  select 'REPLACE_WITH_TENANT_UUID'::uuid as tenant_id
)
update process_routings pr
set
  is_confirmed = true,
  confirmed_at = now(),
  -- 承認者は同テナントの president を採用。存在しなければ NULL のまま
  confirmed_by = (
    select om.user_id
    from organization_members om
    where om.tenant_id = pr.tenant_id
      and om.role = 'president'
    order by om.created_at asc
    limit 1
  )
from params
where pr.tenant_id = params.tenant_id
  and pr.is_confirmed = false;

-- 更新結果の確認（このテナントの工程がすべて確定済みになっているはず）
with params as (
  select 'REPLACE_WITH_TENANT_UUID'::uuid as tenant_id
)
select
  count(*)                                  as total_routings,
  count(*) filter (where is_confirmed)      as confirmed_routings,
  count(*) filter (where not is_confirmed)  as still_unconfirmed
from process_routings pr, params
where pr.tenant_id = params.tenant_id;

-- 件数を見てから判断したい場合は、update までを実行した状態で一旦止め、
-- 別クエリで確認したうえで手動で commit; または rollback; を発行すること。
commit;
