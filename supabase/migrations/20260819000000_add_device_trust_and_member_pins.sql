-- 共有端末向けPIN認証・端末信頼基盤 (Issue #342)
-- 端末を信頼済み端末として登録することで、その端末上に限りPINでの
-- 操作者識別・切り替えを許可する。PINハッシュ・端末信頼レコードは
-- いずれもクライアントJWTから直接読めないようにし、全アクセスを
-- service role (admin_client) 経由のバックエンドロジックに限定する。

CREATE TABLE device_trust_registrations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  device_id     text NOT NULL UNIQUE,
  registered_by uuid NOT NULL REFERENCES auth.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL DEFAULT (now() + interval '1 year'),
  revoked_at    timestamptz
);

ALTER TABLE device_trust_registrations ENABLE ROW LEVEL SECURITY;

-- 端末管理画面（president / platform_admin）からの閲覧用。
-- notifications テーブルと同様、INSERT/UPDATE ポリシーは設定せず、
-- 書き込みは全て service role 経由のバックエンドロジックに限定する
-- (端末信頼の登録・失効はPIN認証の前提となる機微な操作のため)。
CREATE POLICY "tenant admin can view device trusts" ON device_trust_registrations
  FOR SELECT
  USING (
    is_tenant_member(tenant_id)
    AND EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.tenant_id = device_trust_registrations.tenant_id
        AND om.user_id = auth.uid()
        AND om.role IN ('president', 'platform_admin')
    )
  );

CREATE INDEX idx_device_trust_registrations_tenant ON device_trust_registrations (tenant_id);

-- PINは端末未信頼の状態からでも照合できる必要があり(ログイン前)、
-- ユーザーJWTを持たない状態でのアクセスが前提となるため、
-- SELECTポリシーを一切設けず service role のみが読み書きできるようにする。
CREATE TABLE member_pins (
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  user_id         uuid NOT NULL REFERENCES auth.users(id),
  pin_hash        text NOT NULL,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

ALTER TABLE member_pins ENABLE ROW LEVEL SECURITY;
