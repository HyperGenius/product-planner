-- 日報Excel取り込みPoCの基盤 (Issue #469, 親Issue #468)
--
-- 共有Windows PC上のエージェント（PowerShell）が日報Excelをバックエンド経由で
-- Supabase Storage へ送るための受け皿。エージェントはユーザーJWTを持たないため、
-- テナント単位のエージェントトークン（Bearer）で認証し、バックエンドは
-- service role (admin_client) でトークンから tenant_id を解決して読み書きする。
--
-- 書き込みはすべて service role 経由のバックエンドロジックに限定する
-- （device_trust_registrations / member_pins と同じ方針。
-- 20260819000000_add_device_trust_and_member_pins.sql 参照）。
-- そのため3テーブルとも RLS を有効にしたうえで INSERT/UPDATE/DELETE ポリシーは作らない。

-- ---------------------------------------------------------------------------
-- agent_tokens: テナント単位のエージェントトークン
-- ---------------------------------------------------------------------------
-- 平文トークンは発行時に1回表示するだけで保存しない（token_hash に SHA-256 の
-- hex を保存）。トークンは secrets.token_urlsafe(32) 相当の高エントロピー値の
-- ため bcrypt 等の低速ハッシュは不要で、UNIQUE インデックスで直接引ける。
-- 発行・一覧・失効は backend/scripts/issue_agent_token.py で行う。
CREATE TABLE agent_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  name          text NOT NULL,
  token_hash    text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);

-- トークンハッシュは認証の要となる機微な値のため、ユーザーJWTからは一切
-- 参照させない（member_pins と同じく SELECT ポリシーも作らない）。
ALTER TABLE agent_tokens ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_agent_tokens_tenant ON agent_tokens (tenant_id);

-- ---------------------------------------------------------------------------
-- daily_report_files: 受信した日報ファイルのメタデータ
-- ---------------------------------------------------------------------------
-- Storage のキーは {tenant_id}/{sha256}。同一テナントで同一内容のファイルは
-- 1行だけにする（UNIQUE (tenant_id, sha256)）。同時送信時の重複排除も
-- この制約で担保する。
-- original_path はエージェントが URL エンコードして送るファイルパスを復元した値
-- （日本語を含みうるため Storage のキーには使わず、ここに保存する）。
CREATE TABLE daily_report_files (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  agent_token_id    uuid NOT NULL REFERENCES agent_tokens(id),
  sha256            text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_path      text NOT NULL,
  original_path     text NOT NULL,
  file_name         text NOT NULL,
  size_bytes        bigint NOT NULL CHECK (size_bytes >= 0),
  file_modified_at  timestamptz,
  received_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT daily_report_files_tenant_sha256_key UNIQUE (tenant_id, sha256)
);

ALTER TABLE daily_report_files ENABLE ROW LEVEL SECURITY;

-- 将来の閲覧（管理画面・パース処理の確認）用。書き込みポリシーは作らない。
CREATE POLICY "tenant members can view daily report files" ON daily_report_files
  FOR SELECT
  USING (is_tenant_member(tenant_id));

CREATE INDEX idx_daily_report_files_tenant_received
  ON daily_report_files (tenant_id, received_at DESC);

-- ---------------------------------------------------------------------------
-- agent_heartbeats: エージェントの実行ごとのサマリ
-- ---------------------------------------------------------------------------
-- PoC 期間中は途絶アラートを出さず、記録のみ行って手動で確認する。
-- 集計値以外にエージェントが送ってきたサマリは payload にそのまま保存する。
CREATE TABLE agent_heartbeats (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  agent_token_id   uuid NOT NULL REFERENCES agent_tokens(id),
  received_at      timestamptz NOT NULL DEFAULT now(),
  scanned_count    integer NOT NULL DEFAULT 0 CHECK (scanned_count >= 0),
  sent_count       integer NOT NULL DEFAULT 0 CHECK (sent_count >= 0),
  duplicate_count  integer NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),
  error_count      integer NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  agent_version    text,
  payload          jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE agent_heartbeats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members can view agent heartbeats" ON agent_heartbeats
  FOR SELECT
  USING (is_tenant_member(tenant_id));

CREATE INDEX idx_agent_heartbeats_tenant_received
  ON agent_heartbeats (tenant_id, received_at DESC);

-- ---------------------------------------------------------------------------
-- Supabase Storage バケット: daily-reports (private)
-- ---------------------------------------------------------------------------
-- Terraform の supabase provider はバケットを管理できないため、order-attachments
-- (20260630000000_add_order_attachments.sql) と同じくマイグレーションで作る。
-- 読み書きはバックエンド (service role) のみが行うため、storage.objects に
-- authenticated 向けのポリシーは付けない（service role は RLS をバイパスする）。
-- file_size_limit はバックエンドの受信上限（20MB）と揃える。
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('daily-reports', 'daily-reports', false, 20971520)
ON CONFLICT (id) DO NOTHING;
