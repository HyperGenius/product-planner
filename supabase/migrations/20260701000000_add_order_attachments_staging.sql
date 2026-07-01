-- order_attachments のステージング保存対応
-- PDF添付メールは受信時点で orders 行を作成せず、order_id=NULL の
-- ステージング行として保存できるようにする (Issue #248)

alter table order_attachments
  alter column order_id drop not null;

alter table order_attachments
  add column customer_id      bigint references customers(id),
  add column source_raw       text,
  add column gmail_message_id text;
