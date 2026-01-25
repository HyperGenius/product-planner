-- Add status column to orders table
alter table orders 
add column status text not null default 'draft' 
check (status in ('draft', 'confirmed', 'completed', 'canceled'));

comment on column orders.status is '注文ステータス: draft(下書き), confirmed(確定/スケジュール済), completed(完了), canceled(キャンセル)';
