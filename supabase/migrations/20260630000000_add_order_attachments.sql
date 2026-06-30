-- order_attachments テーブルの追加
-- 受注メール添付ファイルのメタデータとStorage参照パスを保持する

create table order_attachments (
  id                uuid primary key default gen_random_uuid(),
  order_id          bigint not null references orders(id) on delete cascade,
  tenant_id         uuid not null references tenants(id),
  storage_path      text not null,
  original_filename text not null,
  content_type      text,
  size_bytes        bigint,
  parse_status      text not null default 'pending'
                    check (parse_status in (
                      'pending',
                      'success',
                      'failed_encrypted',
                      'failed_image',
                      'failed_no_attachment'
                    )),
  created_at        timestamptz not null default now()
);

alter table order_attachments enable row level security;

create policy "tenant isolation" on order_attachments
  for all
  using ((auth.jwt() ->> 'tenant_id')::uuid = tenant_id);

-- Supabase Storage バケット: order-attachments
-- テナントプレフィックス ({tenant_id}/orders/{order_id}/...) でテナント分離する
insert into storage.buckets (id, name, public)
values ('order-attachments', 'order-attachments', false)
on conflict (id) do nothing;

-- バケットポリシー: 認証済みユーザーは自テナントのパスのみ読み書き可
create policy "tenant read own attachments" on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'order-attachments'
    and (storage.foldername(name))[1] = (auth.jwt() ->> 'tenant_id')
  );

create policy "service role full access" on storage.objects
  for all
  to service_role
  using (bucket_id = 'order-attachments');
