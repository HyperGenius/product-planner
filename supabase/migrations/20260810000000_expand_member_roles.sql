-- ==========================================
-- ロール拡張: admin/member の二値から
-- president / iso_officer / order_handler の三値へ移行
--
-- 移行方針:
--   admin  -> president     (受注承認・メンバー管理・工程マスタ編集などの既存 admin 権限一式を引き継ぐ)
--   member -> order_handler (下書き注文の表記揺れ修正・承認依頼送信を担当する現行運用に相当)
-- ==========================================

-- 既存データの移行
update organization_members set role = 'president' where role = 'admin';
update organization_members set role = 'order_handler' where role = 'member';

-- 新ロール値のみを許可する CHECK 制約を追加
alter table organization_members
  add constraint organization_members_role_check
  check (role in ('president', 'iso_officer', 'order_handler'));

-- 新規メンバーのデフォルトロールを order_handler に変更
alter table organization_members
  alter column role set default 'order_handler';

-- サインアップ時に作成される最初のメンバーは president（テナントの代表者）とする
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  new_tenant_id uuid;
  tenant_name text;
begin
  tenant_name := new.raw_user_meta_data->>'tenant_name';

  if tenant_name is not null and tenant_name <> '' then
    begin
      insert into public.tenants (name)
      values (tenant_name)
      returning id into new_tenant_id;

      insert into public.organization_members (user_id, tenant_id, role)
      values (new.id, new_tenant_id, 'president');
    exception when others then
      raise exception 'テナント作成に失敗しました: %', sqlerrm;
    end;
  end if;

  return new;
end;
$$;
