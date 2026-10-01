-- 日報の未照合キュー: 「対象外」にした表記 (Issue #489, 親Issue #485)
--
-- 未照合キュー（GET /daily-reports/unmatched-names）から「対象外」にした表記を持つ。
-- 試作・社内作業などマスタに無くてよい表記をキューに出さないためのもので、照合結果には
-- 影響しない（対象外の表記は照合されないまま。割り付け #490 の対象にもならない）。
--
-- 別名辞書の列（#488 の3テーブル）ではなく専用テーブルにする理由:
--   製品の別名辞書は既存の product_name_aliases（product_id NOT NULL、メール起票の照合と共有）
--   なので「対象外」を持たせられない。4種別を同じ形で扱うため1テーブルにまとめる。
--
-- キーは未照合キューの1行と同じ: 設備・工程・顧客は表記、製品は (顧客先, 商品名) の組。
-- 顧客先が空欄の製品もあるので customer_raw の NULL も1つの値として UNIQUE にする。
CREATE TABLE daily_report_ignored_names (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  kind          text NOT NULL CHECK (kind IN ('equipment', 'process', 'customer', 'product')),
  raw_text      text NOT NULL CHECK (btrim(raw_text) <> ''),
  customer_raw  text CHECK (kind = 'product' OR customer_raw IS NULL),
  created_by    uuid NOT NULL REFERENCES auth.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT daily_report_ignored_names_key
    UNIQUE NULLS NOT DISTINCT (tenant_id, kind, raw_text, customer_raw)
);

ALTER TABLE daily_report_ignored_names ENABLE ROW LEVEL SECURITY;

-- 別名辞書と同じ方針: テナントメンバーが読み書きでき（事務担当者のロールに限るのは API 側）、
-- created_by は INSERT 時に auth.uid() と一致させる。行は登録・削除のみで更新しない。
CREATE POLICY "tenant members can view daily_report_ignored_names"
  ON daily_report_ignored_names FOR SELECT
  USING (is_tenant_member(tenant_id));

CREATE POLICY "tenant members can insert daily_report_ignored_names"
  ON daily_report_ignored_names FOR INSERT
  WITH CHECK (is_tenant_member(tenant_id) AND created_by = auth.uid());

CREATE POLICY "tenant members can delete daily_report_ignored_names"
  ON daily_report_ignored_names FOR DELETE
  USING (is_tenant_member(tenant_id));
