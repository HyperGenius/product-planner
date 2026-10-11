-- 社内転送者と顧客の FAX 番号 (Issue #521)
--
-- 社長（社内の共通メールアカウント）は、FAX 受信の PDF やファイル共有システムで受領した
-- PDF を件名・本文なしで受注取り込み用アドレスへ転送してくる。本文に転送ヘッダーが無いため、
-- 従来は実際の差出人（＝社長のアドレス）で customers.email を突合し、一致しなければ社長の
-- アドレスで下書き顧客を作っていた（Issue #311 の挙動）。
--
-- tenant_internal_senders に登録したアドレスからのメールは、差出人で顧客を突合・作成しない。
-- 顧客は添付の中身（発行元の会社名・FAX 番号）から決め、決まらなければ customer_id NULL
-- （顧客不明）で起票する。
--
-- email は小文字・前後空白なしで保存する（Gmail の From ヘッダーとの比較を単純にするため）。
CREATE TABLE tenant_internal_senders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  email       text NOT NULL CHECK (email <> '' AND email = lower(btrim(email))),
  created_by  uuid NOT NULL REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_internal_senders_key UNIQUE (tenant_id, email)
);

ALTER TABLE tenant_internal_senders ENABLE ROW LEVEL SECURITY;

-- テナントメンバーが読み書きでき（president / platform_admin に限るのは API 側）、
-- created_by は INSERT 時に auth.uid() と一致させる。行は登録・削除のみで更新しない。
-- Gmail 取り込み（cron）は service role で読み、tenant_id で明示的に絞り込む。
CREATE POLICY "tenant members can view tenant_internal_senders"
  ON tenant_internal_senders FOR SELECT
  USING (is_tenant_member(tenant_id));

CREATE POLICY "tenant members can insert tenant_internal_senders"
  ON tenant_internal_senders FOR INSERT
  WITH CHECK (is_tenant_member(tenant_id) AND created_by = auth.uid());

CREATE POLICY "tenant members can delete tenant_internal_senders"
  ON tenant_internal_senders FOR DELETE
  USING (is_tenant_member(tenant_id));

-- 注文書の FAX 送信元番号・発行元の FAX 番号で顧客を照合するための列。
-- 照合は数字だけに正規化して行う（表記はハイフン等を含んだまま保存してよい）。
ALTER TABLE customers ADD COLUMN fax_number text;
