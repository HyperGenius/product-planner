-- 製品マスタから表記ゆれ辞書エントリを直接編集・削除できるようにする（Issue #351）
--
-- #350 で未検証の自動マッチ結果（source='auto_match_unreviewed'）も辞書に載る
-- ようになるため、誤りに気づいた担当者がその場で修正・削除できる経路が必要。
-- 別名登録自体が承認不要（#347）なのと同様、直接編集・削除も president の承認
-- フローを経由しない（order_handler 権限で実行可能）。

-- --- product_name_alias_history.action に 'deleted' を追加 ---
-- 直接編集は 'updated'、削除は 'deleted' として記録する。削除時も監査目的で
-- history 行は残し、product_name_aliases 側の行だけ削除する。
ALTER TABLE product_name_alias_history
  DROP CONSTRAINT product_name_alias_history_action_check;

ALTER TABLE product_name_alias_history
  ADD CONSTRAINT product_name_alias_history_action_check
  CHECK (action IN ('created', 'updated', 'deleted'));

-- --- product_name_aliases の DELETE ポリシー ---
-- #347 では INSERT / UPDATE / SELECT のみ定義していた。製品マスタからの直接削除
-- （ユーザーJWT経由）を許可するため DELETE ポリシーを追加する。テナントメンバー
-- なら誰でも可（承認不要方針を踏襲）。
CREATE POLICY "tenant members can delete product_name_aliases"
  ON product_name_aliases
  FOR DELETE
  USING (is_tenant_member(tenant_id));
