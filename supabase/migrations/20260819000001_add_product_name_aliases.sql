-- 製品名の表記ゆれ辞書（メールから起票された下書き注文の product_id 修正結果を
-- 別名として蓄積し、以後の自動マッチングに活用する。Issue #347）

-- product_name_aliases: raw_text（メール抽出時の extracted_product_name）から
-- 製品への最新の対応を保持する。同一 raw_text への再修正は UPSERT（上書き）する。
CREATE TABLE product_name_aliases (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  product_id  bigint NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  raw_text    text NOT NULL,
  created_by  uuid NOT NULL REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, raw_text)
);

ALTER TABLE product_name_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members can manage product_name_aliases"
  ON product_name_aliases
  FOR ALL
  USING (is_tenant_member(tenant_id))
  WITH CHECK (is_tenant_member(tenant_id));

-- backend/app/dependencies.py の get_supabase_admin_client 経由（cron によるメール/PDF
-- 起票パイプライン）は Service Role Key で RLS をバイパスするため、上記ポリシーは
-- ユーザーJWT経由の呼び出し（別名の登録・履歴閲覧）のみに適用される。
CREATE TRIGGER product_name_aliases_set_updated_at
  BEFORE UPDATE ON product_name_aliases
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

CREATE INDEX idx_product_name_aliases_tenant_raw_text
  ON product_name_aliases (tenant_id, raw_text);

-- product_name_alias_history: 追記のみの監査履歴。product_id / source_order_id は
-- 製品削除・注文削除で行ごと消えないよう ON DELETE SET NULL とし、削除後も文脈が
-- 読めるようスナップショット列（製品表示名・注文ラベル）を保持する。
CREATE TABLE product_name_alias_history (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid NOT NULL REFERENCES tenants(id),
  product_id                  bigint REFERENCES products(id) ON DELETE SET NULL,
  product_name_snapshot       text NOT NULL,
  raw_text                    text NOT NULL,
  changed_by                  uuid NOT NULL REFERENCES auth.users(id),
  changed_at                  timestamptz NOT NULL DEFAULT now(),
  action                      text NOT NULL CHECK (action IN ('created', 'updated')),
  source_order_id             bigint REFERENCES orders(id) ON DELETE SET NULL,
  source_order_label_snapshot text NOT NULL
);

ALTER TABLE product_name_alias_history ENABLE ROW LEVEL SECURITY;

-- 追記のみの監査履歴のため UPDATE/DELETE ポリシーは設けない
CREATE POLICY "tenant members can view product_name_alias_history"
  ON product_name_alias_history
  FOR SELECT
  USING (is_tenant_member(tenant_id));

CREATE POLICY "tenant members can insert product_name_alias_history"
  ON product_name_alias_history
  FOR INSERT
  WITH CHECK (is_tenant_member(tenant_id) AND changed_by = auth.uid());

CREATE INDEX idx_product_name_alias_history_tenant_product
  ON product_name_alias_history (tenant_id, product_id, changed_at DESC);
