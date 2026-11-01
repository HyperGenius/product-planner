-- Issue #608: 顧客に複数の担当者（メールアドレス）を持たせる customer_contacts を新設する。
--
-- 従来は customers.email が 1 顧客 1 アドレスで、未知の担当者のアドレスごとに
-- 「担当者名つきの下書き顧客」が作られ、同じ会社の注文が複数の顧客に分かれていた。
-- Gmail 取り込みの顧客突合はこのテーブルで行う。customers.email は互換のため残す。
--
-- email は小文字・前後空白なしで保存する（tenant_internal_senders と同じ。Gmail の From との比較を単純にするため）。
-- 同じアドレスが 2 つの顧客に属すると突合が曖昧になるので (tenant_id, email) を UNIQUE にする。
CREATE TABLE customer_contacts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  customer_id  bigint NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  email        text NOT NULL CHECK (email <> '' AND email = lower(btrim(email))),
  contact_name text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_contacts_key UNIQUE (tenant_id, email)
);

CREATE INDEX idx_customer_contacts_customer ON customer_contacts (customer_id);

ALTER TABLE customer_contacts ENABLE ROW LEVEL SECURITY;

-- Gmail 取り込み（cron）は service role で読み書きし、tenant_id で明示的に絞り込む。
CREATE POLICY "tenant members can view customer_contacts"
  ON customer_contacts FOR SELECT
  USING (is_tenant_member(tenant_id));

CREATE POLICY "tenant members can insert customer_contacts"
  ON customer_contacts FOR INSERT
  WITH CHECK (is_tenant_member(tenant_id));

CREATE POLICY "tenant members can update customer_contacts"
  ON customer_contacts FOR UPDATE
  USING (is_tenant_member(tenant_id))
  WITH CHECK (is_tenant_member(tenant_id));

CREATE POLICY "tenant members can delete customer_contacts"
  ON customer_contacts FOR DELETE
  USING (is_tenant_member(tenant_id));

-- 初期移行: customers.email が入っている顧客を担当者として複製する。
-- 正規化（小文字・前後空白除去）後に重複するアドレスは、先に登録された顧客（id が小さい方）を優先する。
INSERT INTO customer_contacts (tenant_id, customer_id, email)
SELECT DISTINCT ON (tenant_id, lower(btrim(email)))
       tenant_id, id, lower(btrim(email))
FROM customers
WHERE email IS NOT NULL AND btrim(email) <> ''
ORDER BY tenant_id, lower(btrim(email)), id;
