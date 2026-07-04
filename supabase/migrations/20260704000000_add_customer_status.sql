-- Add status column to customers table (Issue #263)
-- メール/PDF起票で顧客が特定できない場合に自動作成される「下書き」顧客を
-- 正規登録の顧客と区別するためのフラグ。既存の全顧客は default 'active' により
-- そのまま active 扱いになる（マイグレーションによる既存データへの影響なし）。
alter table customers
add column status text not null default 'active'
check (status in ('active', 'draft'));

comment on column customers.status is '顧客ステータス: active(登録済み), draft(自動作成された下書き。手直しして保存すると active になる)';
