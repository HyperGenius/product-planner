-- Issue #619: 顧客からの督促・分割納入の依頼メールを、注文として起票せず既存の受注に紐づけて記録する。
--
-- メール本文に品番・数量・納期が書かれた督促は、従来は新規注文として下書き起票されていた。
-- 起票せずこのテーブルに残し、受注詳細に「顧客から督促あり」と表示する（受注の納期・数量・ステータスは書き換えない）。
--
-- order_id が NULL の行は、対象の受注を一意に決められなかった督促（未紐づけ）。
-- 受注が削除（下書きの分割・削除）されても依頼の記録は残すので ON DELETE SET NULL にする。
-- 取り込み（cron）は service role で書き込み、tenant_id で明示的に絞り込む。同じメールの再処理で二重に
-- 記録しないよう (order_attachment_id, line_index) を UNIQUE にする。
CREATE TABLE order_delivery_requests (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id),
  order_id             bigint REFERENCES orders(id) ON DELETE SET NULL,
  order_attachment_id  uuid REFERENCES order_attachments(id) ON DELETE SET NULL,
  line_index           integer NOT NULL DEFAULT 0,
  kind                 text NOT NULL CONSTRAINT order_delivery_requests_kind_chk
                       CHECK (kind IN ('delivery_chase', 'split_delivery')),
  extracted_product_name text,
  quantity             integer,
  requested_date       date,
  body_snippet         text,
  resolved_at          timestamptz,
  resolved_by          uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_delivery_requests_resolved_pair_chk
    CHECK ((resolved_at IS NULL) = (resolved_by IS NULL))
);

CREATE UNIQUE INDEX order_delivery_requests_attachment_line_key
  ON order_delivery_requests (order_attachment_id, line_index)
  WHERE order_attachment_id IS NOT NULL;
CREATE INDEX idx_order_delivery_requests_order ON order_delivery_requests (order_id);
CREATE INDEX idx_order_delivery_requests_open
  ON order_delivery_requests (tenant_id) WHERE resolved_at IS NULL;

ALTER TABLE order_delivery_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members can view order_delivery_requests"
  ON order_delivery_requests FOR SELECT
  USING (is_tenant_member(tenant_id));

-- 対応済みの更新だけをユーザー JWT で行う（INSERT は取り込み側の service role）。
CREATE POLICY "tenant members can update order_delivery_requests"
  ON order_delivery_requests FOR UPDATE
  USING (is_tenant_member(tenant_id))
  WITH CHECK (is_tenant_member(tenant_id));
