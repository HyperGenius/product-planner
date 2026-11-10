-- 弥生販売の売上伝票 CSV の受け皿 (Issue #662)
--
-- 送品の正典は弥生販売。事務PCが書き出した CSV を、(1) 日報エージェント端末のエージェントが
-- 共有フォルダから回収して送る経路と、(2) 事務PCのブラウザからアプリへ直接アップロードする
-- 経路の2つで受け取る。どちらも生ファイルをそのまま保存するだけで、解析・突合は CSV の形式が
-- 確定してから別の変更で足す（エージェントを形式に依存させず、再訪問なしで解析を直せるようにする）。
--
-- 書き込みの経路:
--   - エージェント: ユーザー JWT を持たないので service role のバックエンドが書く（日報と同じ）
--   - アプリ: ユーザー JWT で書く。テナントメンバーだけが自テナントのパスに書ける（下のポリシー）

CREATE TABLE shipment_files (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  source            text NOT NULL CHECK (source IN ('agent', 'web')),
  -- agent 経由は agent_token_id、web 経由は uploaded_by（auth.users.id）のどちらかが入る
  agent_token_id    uuid REFERENCES agent_tokens(id),
  uploaded_by       uuid,
  sha256            text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_path      text NOT NULL,
  original_path     text NOT NULL,
  file_name         text NOT NULL,
  size_bytes        bigint NOT NULL CHECK (size_bytes >= 0),
  file_modified_at  timestamptz,
  received_at       timestamptz NOT NULL DEFAULT now(),
  -- 同一内容のファイルは1行だけ（再出力・再送・同時送信の重複排除）
  CONSTRAINT shipment_files_tenant_sha256_key UNIQUE (tenant_id, sha256),
  CONSTRAINT shipment_files_sender_check CHECK (
    (source = 'agent' AND agent_token_id IS NOT NULL)
    OR (source = 'web' AND uploaded_by IS NOT NULL)
  )
);

ALTER TABLE shipment_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members can view shipment files" ON shipment_files
  FOR SELECT
  USING (is_tenant_member(tenant_id));

-- アプリからのアップロードだけがユーザー JWT で INSERT する。エージェント経由の行は service role が書く。
-- 実際に書けるロールの絞り込みは API 側（事務担当者のみ）で行い、ここは自テナント・web のみを保証する。
CREATE POLICY "tenant members can insert web shipment files" ON shipment_files
  FOR INSERT
  WITH CHECK (
    is_tenant_member(tenant_id)
    AND source = 'web'
    AND uploaded_by = auth.uid()
  );

CREATE INDEX idx_shipment_files_tenant_received
  ON shipment_files (tenant_id, received_at DESC);

-- ---------------------------------------------------------------------------
-- Supabase Storage バケット: shipment-files (private)
-- ---------------------------------------------------------------------------
-- キーは {tenant_id}/{sha256}{拡張子}。file_size_limit はバックエンドの受信上限（20MB）と揃える。
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('shipment-files', 'shipment-files', false, 20971520)
ON CONFLICT (id) DO NOTHING;

-- アプリのアップロードは自テナントのフォルダへの追加のみ（上書き・削除はさせない）。
-- auth.jwt() ->> 'tenant_id' は発行されていないので、organization_members の所属で判定する。
-- 先頭フォルダが UUID でないキーで ::uuid の変換が失敗しないよう、形式を確かめてから変換する。
CREATE POLICY "tenant members can upload shipment files" ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'shipment-files'
    AND CASE
      WHEN (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN is_tenant_member(((storage.foldername(name))[1])::uuid)
      ELSE false
    END
  );
