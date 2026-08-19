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

-- backend/app/dependencies.py の get_supabase_admin_client 経由（cron によるメール/PDF
-- 起票パイプライン）は Service Role Key で RLS をバイパスするため、以下のポリシーは
-- ユーザーJWT経由の呼び出し（別名の登録・履歴閲覧）のみに適用される。
CREATE POLICY "tenant members can view product_name_aliases"
  ON product_name_aliases
  FOR SELECT
  USING (is_tenant_member(tenant_id));

-- created_by は「最初に登録したユーザー」を表す監査カラム。クライアントが任意の
-- created_by を指定して他人になりすませないよう、INSERT時は auth.uid() と一致する
-- ことを強制する（PRレビュー指摘対応）。UPDATE（別名の上書き）では created_by を
-- 変更させない（下の product_name_aliases_preserve_created_by トリガー参照）。
CREATE POLICY "tenant members can insert product_name_aliases"
  ON product_name_aliases
  FOR INSERT
  WITH CHECK (is_tenant_member(tenant_id) AND created_by = auth.uid());

CREATE POLICY "tenant members can update product_name_aliases"
  ON product_name_aliases
  FOR UPDATE
  USING (is_tenant_member(tenant_id))
  WITH CHECK (is_tenant_member(tenant_id));

CREATE TRIGGER product_name_aliases_set_updated_at
  BEFORE UPDATE ON product_name_aliases
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- created_by（最初の登録者）はUPDATEでは変更させない。誰が今回の修正を行ったかは
-- product_name_alias_history.changed_by 側に記録される（PRレビュー指摘対応）。
CREATE OR REPLACE FUNCTION public.preserve_product_name_alias_created_by()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.created_by := OLD.created_by;
  RETURN NEW;
END;
$$;

CREATE TRIGGER product_name_aliases_preserve_created_by
  BEFORE UPDATE ON product_name_aliases
  FOR EACH ROW EXECUTE PROCEDURE public.preserve_product_name_alias_created_by();

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

-- 取得クエリ（ProductNameAliasHistoryRepository.get_by_product_id）は product_id の
-- みで絞り込む（tenant分離はRLSに委譲）ため、そのクエリ形に合わせたインデックスとする
-- （PRレビュー指摘対応）。
CREATE INDEX idx_product_name_alias_history_product_changed_at
  ON product_name_alias_history (product_id, changed_at DESC);
