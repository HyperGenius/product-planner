-- ==========================================
-- public スキーマの標準ロールへの権限復旧
-- ==========================================
-- ローカル Supabase CLI (2.113.0 で確認) で `supabase db reset` を実行すると、
-- anon / authenticated / service_role に対する public スキーマ配下の
-- テーブル・シーケンス・関数への基本権限（SELECT/INSERT/UPDATE/DELETE/EXECUTE等）が
-- 自動付与されず、RLSポリシーの評価より前に
-- "permission denied for table ..." (SQLSTATE 42501) で弾かれる事象を確認した。
-- 通常はSupabase側のブートストラップで自動的に GRANT/ALTER DEFAULT PRIVILEGES が
-- 設定されるはずだが、何らかの理由で欠落していたため、本マイグレーションで明示的に
-- 宣言する。
--
-- anon / authenticated は PostgREST 経由でRLSと組み合わせて使われる想定のため、
-- 実データ操作に必要な最小限（テーブル: SELECT/INSERT/UPDATE/DELETE、
-- シーケンス: USAGE/SELECT、関数: EXECUTE）のみを付与し、TRUNCATE/REFERENCES/
-- TRIGGER 等スキーマ変更に近い権限は含めない。service_role はRLSを常に
-- バイパスする信頼済みロール（アプリコードからは使用禁止、backend/scripts の
-- 管理スクリプトからのみ使用）のため、既存のSupabase標準構成に合わせて ALL を付与する。
--
-- 本番 Supabase では既に正しく権限が付与されている想定のため、以下は
-- 冪等な再付与（既存権限の再宣言）にしかならず、実害はない。
-- ==========================================

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete
  on all tables in schema public to anon, authenticated;
grant usage, select
  on all sequences in schema public to anon, authenticated;
grant execute
  on all functions in schema public to anon, authenticated;

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant all on all functions in schema public to service_role;

-- 今後 (このマイグレーション以降) に作成されるテーブル・シーケンス・関数にも
-- 同様の権限が自動付与されるようにする
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated;
alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated;
alter default privileges in schema public
  grant execute on functions to anon, authenticated;

alter default privileges in schema public
  grant all on tables to service_role;
alter default privileges in schema public
  grant all on sequences to service_role;
alter default privileges in schema public
  grant all on functions to service_role;
