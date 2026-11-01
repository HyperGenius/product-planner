-- ==========================================
-- 未登録アドレスの注文は顧客不明で起票し、受注担当者が既存の顧客へ紐づける（Issue #609）
--
-- 1. order_attachments.sender_email: メールの差出人（本文の転送ヘッダー → 実From → 本文の順で解決したアドレス）。
--    紐づけるときに担当者（customer_contacts）へ登録するアドレスで、同じアドレスの顧客不明の注文・
--    ステージング行をまとめて紐づけ直す条件にも使う。小文字・前後空白なしで保存する（customer_contacts と同じ）。
--    この列を入れる前に取り込んだ行は NULL（紐づけても担当者の登録は提案しない）。
-- 2. link_customer_to_unknown_orders: 注文・ステージング行・担当者の更新を1トランザクションで行う RPC。
-- ==========================================

ALTER TABLE order_attachments
  ADD COLUMN sender_email text CHECK (sender_email IS NULL OR sender_email = lower(btrim(sender_email)));

COMMENT ON COLUMN order_attachments.sender_email IS
  'Gmail 取り込みで解決した差出人アドレス（小文字）。ステージング行（order_id IS NULL）にだけ入る。'
  '顧客不明の注文を既存の顧客へ紐づけるとき、担当者（customer_contacts）への登録とまとめ直しに使う（Issue #609）。';

-- 顧客不明の行を差出人で探す（まとめて紐づけ直す）ためのインデックス
CREATE INDEX idx_order_attachments_unlinked_sender
  ON order_attachments (tenant_id, sender_email)
  WHERE customer_id IS NULL AND sender_email IS NOT NULL;

-- ------------------------------------------
-- link_customer_to_unknown_orders
--
-- 顧客不明（customer_id IS NULL）の注文 p_order_id に既存の顧客 p_customer_id を紐づける。
--   p_register_contact       true なら注文の元メールの差出人アドレスを、その顧客の担当者として登録する。
--                            そのアドレスが既に別の顧客の担当者なら上書きせず P0001 で失敗する
--   p_apply_to_same_sender   true なら同じ差出人アドレスの、顧客不明の下書き注文とステージング行も同じ顧客へ紐づける。
--                            まとめ直しの対象が他の注文と重複（orders_dedupe_key 等）する場合は、その注文だけ
--                            紐づけずに skipped_order_ids で返す（指定した注文自身の重複は 23505 で全体を失敗させる）
--
-- orders.customer_id の更新はトリガー trg_sync_order_attachments_customer_id（Issue #315）が
-- 注文のステージング行・添付行へ同期する。まだ注文になっていないステージング行（パース前）は直接更新する。
--
-- 戻り値: {"contact_registered": bool, "sender_email": text|null,
--          "linked_order_ids": [...], "skipped_order_ids": [...], "linked_staging_count": int}
-- エラー: 42501 権限なし / P0002 注文が無い / 55000 顧客不明ではない / 23503 顧客が無い /
--         P0001 担当者のアドレスが別の顧客に登録済み / 23505 注文の重複
-- ------------------------------------------
CREATE OR REPLACE FUNCTION link_customer_to_unknown_orders(
  p_tenant_id             uuid,
  p_order_id              bigint,
  p_customer_id           bigint,
  p_register_contact      boolean DEFAULT true,
  p_apply_to_same_sender  boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_customer_id        bigint;
  v_source_attachment  uuid;
  v_sender             text;
  v_owner              bigint;
  v_registered         boolean := false;
  v_linked             bigint[] := ARRAY[p_order_id];
  v_skipped            bigint[] := ARRAY[]::bigint[];
  v_staging_count      integer := 0;
  v_sibling            bigint;
BEGIN
  IF NOT is_tenant_member(p_tenant_id) THEN
    RAISE EXCEPTION 'link_customer_to_unknown_orders: permission denied' USING ERRCODE = '42501';
  END IF;

  SELECT o.customer_id, o.source_attachment_id
    INTO v_customer_id, v_source_attachment
    FROM orders o
   WHERE o.tenant_id = p_tenant_id AND o.id = p_order_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'link_customer_to_unknown_orders: order not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_customer_id IS NOT NULL THEN
    RAISE EXCEPTION 'link_customer_to_unknown_orders: order already has a customer' USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM customers c WHERE c.tenant_id = p_tenant_id AND c.id = p_customer_id
  ) THEN
    RAISE EXCEPTION 'link_customer_to_unknown_orders: customer not found' USING ERRCODE = '23503';
  END IF;

  IF v_source_attachment IS NOT NULL THEN
    SELECT a.sender_email INTO v_sender
      FROM order_attachments a
     WHERE a.tenant_id = p_tenant_id AND a.id = v_source_attachment;
  END IF;

  -- 担当者の登録。(tenant_id, email) は UNIQUE なので、別の顧客に登録済みなら上書きせず失敗させる
  IF p_register_contact AND v_sender IS NOT NULL THEN
    SELECT cc.customer_id INTO v_owner
      FROM customer_contacts cc
     WHERE cc.tenant_id = p_tenant_id AND cc.email = v_sender;
    IF FOUND THEN
      IF v_owner <> p_customer_id THEN
        RAISE EXCEPTION 'link_customer_to_unknown_orders: contact belongs to another customer'
          USING ERRCODE = 'P0001';
      END IF;
    ELSE
      INSERT INTO customer_contacts (tenant_id, customer_id, email)
      VALUES (p_tenant_id, p_customer_id, v_sender);
      v_registered := true;
    END IF;
  END IF;

  UPDATE orders SET customer_id = p_customer_id
   WHERE tenant_id = p_tenant_id AND id = p_order_id;

  IF p_apply_to_same_sender AND v_sender IS NOT NULL THEN
    FOR v_sibling IN
      SELECT o.id
        FROM orders o
        JOIN order_attachments a
          ON a.id = o.source_attachment_id AND a.tenant_id = o.tenant_id
       WHERE o.tenant_id = p_tenant_id
         AND o.id <> p_order_id
         AND o.customer_id IS NULL
         AND o.status = 'draft'
         AND a.sender_email = v_sender
       ORDER BY o.id
         FOR UPDATE OF o
    LOOP
      BEGIN
        UPDATE orders SET customer_id = p_customer_id
         WHERE tenant_id = p_tenant_id AND id = v_sibling;
        v_linked := v_linked || v_sibling;
      EXCEPTION WHEN unique_violation THEN
        v_skipped := v_skipped || v_sibling;
      END;
    END LOOP;

    -- まだ注文になっていないステージング行（パース前・起票0件）
    UPDATE order_attachments
       SET customer_id = p_customer_id
     WHERE tenant_id = p_tenant_id
       AND order_id IS NULL
       AND customer_id IS NULL
       AND sender_email = v_sender
       AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.source_attachment_id = order_attachments.id);
    GET DIAGNOSTICS v_staging_count = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'contact_registered', v_registered,
    'sender_email', v_sender,
    'linked_order_ids', to_jsonb(v_linked),
    'skipped_order_ids', to_jsonb(v_skipped),
    'linked_staging_count', v_staging_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION link_customer_to_unknown_orders(uuid, bigint, bigint, boolean, boolean)
  TO authenticated;
