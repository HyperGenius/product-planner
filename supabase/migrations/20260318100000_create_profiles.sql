-- ==========================================
-- profiles テーブルの作成
-- ==========================================
-- ユーザーの氏名などプロフィール情報を管理するテーブル
-- id は auth.users.id を参照する

create table if not exists public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  full_name text,
  email text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ==========================================
-- RLS の有効化
-- ==========================================
alter table public.profiles enable row level security;

-- ==========================================
-- RLS ポリシーの定義
-- ==========================================

-- 同じテナントのメンバーはプロフィールを参照できる
create policy "Tenant members can view profiles"
  on public.profiles for select
  using (
    exists (
      select 1 from organization_members as om_viewer
      where om_viewer.user_id = auth.uid()
        and exists (
          select 1 from organization_members as om_target
          where om_target.user_id = profiles.id
            and om_target.tenant_id = om_viewer.tenant_id
        )
    )
  );

-- 自分自身のプロフィールは更新できる
create policy "Users can update own profile"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- ==========================================
-- updated_at 自動更新トリガー
-- ==========================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute procedure public.set_updated_at();
