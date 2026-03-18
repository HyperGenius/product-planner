-- ==========================================
-- profiles テーブルへの INSERT ポリシー追加
-- ユーザーが自分自身のプロフィールを作成できるようにする
-- ==========================================

-- 自分自身のプロフィールは作成できる
create policy "Users can insert own profile"
  on public.profiles for insert
  with check (id = auth.uid());
