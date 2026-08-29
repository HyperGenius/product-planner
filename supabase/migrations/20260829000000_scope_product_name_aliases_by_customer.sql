-- 製品名の表記ゆれ辞書を顧客単位でスコープする（1顧客:N別名 → 1製品。Issue #349）
--
-- #347 で導入した product_name_aliases は (tenant_id, raw_text) 一意でテナント単位
-- だったため、顧客Aが「エコ材A」と呼ぶ製品Xと顧客Bが同じ表記で呼ぶ製品Yが衝突し、
-- 後から登録した側が前の対応を上書きしてしまう問題があった。customer_id を加えて
-- (tenant_id, customer_id, raw_text) 一意に変更する。
--
-- 2026-08-29 時点で product_name_aliases / product_name_alias_history は本番含め
-- まだ空（#347 実装直後で実データ蓄積前）のためバックフィルは不要。customer_id を
-- NOT NULL 制約付きで追加し、UNIQUE 制約・インデックスを張り替えるだけでよい。
-- 適用直前に本番の両テーブルが空であることを SELECT count(*) で確認すること。

-- --- product_name_aliases ---
ALTER TABLE product_name_aliases
  ADD COLUMN customer_id bigint NOT NULL REFERENCES customers(id) ON DELETE CASCADE;

ALTER TABLE product_name_aliases
  DROP CONSTRAINT product_name_aliases_tenant_id_raw_text_key;

ALTER TABLE product_name_aliases
  ADD CONSTRAINT product_name_aliases_tenant_id_customer_id_raw_text_key
  UNIQUE (tenant_id, customer_id, raw_text);

DROP INDEX idx_product_name_aliases_tenant_raw_text;

CREATE INDEX idx_product_name_aliases_tenant_customer_raw_text
  ON product_name_aliases (tenant_id, customer_id, raw_text);

-- --- product_name_alias_history ---
-- product_id / source_order_id と同様、顧客削除で履歴行ごと消えないよう customer_id は
-- ON DELETE SET NULL とし、削除後も文脈が読めるようスナップショット列を保持する。
ALTER TABLE product_name_alias_history
  ADD COLUMN customer_id bigint REFERENCES customers(id) ON DELETE SET NULL,
  ADD COLUMN customer_name_snapshot text NOT NULL;
