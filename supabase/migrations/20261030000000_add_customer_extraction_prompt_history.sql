-- ==========================================
-- 顧客ごとの抽出指示を画面で編集・試し読みする（Issue #602）
--
-- 1. customer_extraction_prompt_history: customers.order_extraction_prompt の変更履歴（追記のみ）。
--    prompt が NULL の行は「空に戻した（汎用プロンプトのみ）」版。changed_by が NULL の行は
--    画面以外で入った値（このマイグレーションの時点の値・SQL での直接変更）を記録したもの。
--    顧客を消したら履歴も消す（ON DELETE CASCADE）。顧客を統合する機能は無いので付け替えは不要。
-- 2. save_customer_extraction_prompt: 顧客の指示の更新と履歴の追記を1トランザクションで行う RPC。
-- 3. order-attachments バケットの読み取りポリシーの張り直し（試し読みで過去のPDFを
--    ユーザー JWT でダウンロードするため）。
-- ==========================================

CREATE TABLE customer_extraction_prompt_history (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  customer_id bigint NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  prompt      text,
  changed_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE customer_extraction_prompt_history IS
  '顧客ごとの抽出指示（customers.order_extraction_prompt）の変更履歴。追記のみで、'
  '書き込みは RPC save_customer_extraction_prompt だけが行う。版の新旧は id の順。';
COMMENT ON COLUMN customer_extraction_prompt_history.prompt IS
  '変更後の指示。NULL は空に戻した（汎用プロンプトのみで抽出する）版。';
COMMENT ON COLUMN customer_extraction_prompt_history.changed_by IS
  '変更したユーザー。NULL は画面以外で入った値（移行時点の値・SQL での直接変更）。';

CREATE INDEX idx_customer_extraction_prompt_history_customer
  ON customer_extraction_prompt_history (tenant_id, customer_id, id DESC);

ALTER TABLE customer_extraction_prompt_history ENABLE ROW LEVEL SECURITY;

-- 閲覧はテナントのメンバーに許す（API で platform_admin に絞る）。
-- INSERT / UPDATE / DELETE のポリシーは作らない（追記は SECURITY DEFINER の RPC だけが行う）
CREATE POLICY "tenant members can view customer_extraction_prompt_history"
  ON customer_extraction_prompt_history
  FOR SELECT
  USING (is_tenant_member(tenant_id));

-- 前後の空白（改行・タブ・全角空白を含む）を除き、空なら NULL にする。
-- btrim() の既定は半角スペースだけなので、Backend の str.strip() と揃えて文字を明示する
CREATE OR REPLACE FUNCTION normalize_extraction_prompt(p_prompt text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(btrim(p_prompt, E' \t\n\r\f' || chr(11) || chr(12288)), '')
$$;

-- 移行時点の指示を初版として残す（以降の保存で「変更前」が分かるように）
INSERT INTO customer_extraction_prompt_history (tenant_id, customer_id, prompt, changed_by)
SELECT tenant_id, id, normalize_extraction_prompt(order_extraction_prompt), NULL
FROM customers
WHERE normalize_extraction_prompt(order_extraction_prompt) IS NOT NULL
ORDER BY id;


-- ------------------------------------------
-- 抽出指示の保存
-- ------------------------------------------
-- - 編集できるのは platform_admin のみ（Backend `_EXTRACTION_PROMPT_EDITOR_ROLES` と揃える）
-- - 前後の空白を除き（normalize_extraction_prompt）、空文字は NULL（汎用プロンプトのみ）にする。2000文字を超えたら 22001
-- - 履歴の最新と今の値が違う（画面以外で書き換えられた）ときは、今の値を changed_by NULL の版として
--   先に残してから保存する。今の値と同じなら何も書かず changed=false を返す
-- - 顧客が無ければ P0002、ロールが足りなければ 42501
CREATE OR REPLACE FUNCTION save_customer_extraction_prompt(
  p_tenant_id   uuid,
  p_customer_id bigint,
  p_prompt      text
)
RETURNS TABLE (changed boolean, saved_prompt text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new    text := normalize_extraction_prompt(p_prompt);
  v_old    text;
  v_latest text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM organization_members m
    WHERE m.tenant_id = p_tenant_id
      AND m.user_id = auth.uid()
      AND m.role = 'platform_admin'
  ) THEN
    RAISE EXCEPTION 'extraction prompt editor role required' USING ERRCODE = '42501';
  END IF;

  IF v_new IS NOT NULL AND char_length(v_new) > 2000 THEN
    RAISE EXCEPTION 'extraction prompt is too long' USING ERRCODE = '22001';
  END IF;

  SELECT normalize_extraction_prompt(c.order_extraction_prompt)
  INTO v_old
  FROM customers c
  WHERE c.tenant_id = p_tenant_id
    AND c.id = p_customer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer not found' USING ERRCODE = 'P0002';
  END IF;

  -- 履歴が無いときの v_latest は NULL（＝指示なし）として比べる
  SELECT h.prompt
  INTO v_latest
  FROM customer_extraction_prompt_history h
  WHERE h.tenant_id = p_tenant_id
    AND h.customer_id = p_customer_id
  ORDER BY h.id DESC
  LIMIT 1;

  IF v_old IS DISTINCT FROM v_latest THEN
    INSERT INTO customer_extraction_prompt_history (tenant_id, customer_id, prompt, changed_by)
    VALUES (p_tenant_id, p_customer_id, v_old, NULL);
  END IF;

  IF v_new IS NOT DISTINCT FROM v_old THEN
    RETURN QUERY SELECT false, v_old;
    RETURN;
  END IF;

  UPDATE customers c
  SET order_extraction_prompt = v_new
  WHERE c.tenant_id = p_tenant_id
    AND c.id = p_customer_id;

  INSERT INTO customer_extraction_prompt_history (tenant_id, customer_id, prompt, changed_by)
  VALUES (p_tenant_id, p_customer_id, v_new, auth.uid());

  RETURN QUERY SELECT true, v_new;
END;
$$;

REVOKE ALL ON FUNCTION save_customer_extraction_prompt(uuid, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION save_customer_extraction_prompt(uuid, bigint, text) TO authenticated;


-- ------------------------------------------
-- order-attachments バケットの読み取りポリシー
-- ------------------------------------------
-- 20260630000000 のポリシーは auth.jwt() ->> 'tenant_id' を見ていたが、このクレームは発行されて
-- おらず（20260710000000 で order_attachments テーブル側だけ直した）、ユーザー JWT では一度も
-- 読めていなかった（署名付きURLの発行はバックエンドの service role で行っていた）。
-- テーブルと同じく organization_members の所属で判定する。先頭フォルダは
-- テナントID（{tenant_id}/inbox/...・{tenant_id}/manual/...）。
-- uuid へのキャストは他バケットの名前で失敗しうるので、テナントIDを text にして比べる。
DROP POLICY IF EXISTS "tenant read own attachments" ON storage.objects;

CREATE POLICY "tenant members read order attachments"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'order-attachments'
    AND EXISTS (
      SELECT 1
      FROM public.organization_members m
      WHERE m.user_id = auth.uid()
        AND m.tenant_id::text = (storage.foldername(name))[1]
    )
  );
