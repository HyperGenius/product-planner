-- ==========================================
-- サインアップトリガー: テナントとメンバーの自動作成
-- auth.users へのINSERT後に発火し、
-- tenants テーブルへのレコード作成と
-- organization_members への admin 登録を行う
-- ==========================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  new_tenant_id uuid;
  tenant_name text;
begin
  -- メタデータからテナント名を取得
  tenant_name := new.raw_user_meta_data->>'tenant_name';

  -- テナント名が指定されている場合のみテナントを作成
  if tenant_name is not null and tenant_name <> '' then
    begin
      insert into public.tenants (name)
      values (tenant_name)
      returning id into new_tenant_id;

      insert into public.organization_members (user_id, tenant_id, role)
      values (new.id, new_tenant_id, 'admin');
    exception when others then
      raise exception 'テナント作成に失敗しました: %', sqlerrm;
    end;
  end if;

  return new;
end;
$$;

-- 既存のトリガーが存在する場合は削除してから再作成
drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
