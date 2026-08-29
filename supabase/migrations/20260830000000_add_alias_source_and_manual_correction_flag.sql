-- 承認依頼時に自動マッチング結果も表記ゆれ辞書へ反映する（Issue #350）
--
-- #347 では担当者が下書き注文の product_id を「手動で修正」した場合のみ
-- product_name_aliases に反映していた。本Issueでは pg_trgm 自動マッチのまま
-- order_handler が承認依頼を送信したケース（担当者の目は通っているが明示的な
-- 修正はしていない）も辞書へ蓄積する。ただし未検証の推定であることを区別できる
-- よう、辞書エントリ・履歴に由来（source）を記録する。

-- --- orders: 担当者が product_id を手動修正したかどうかのフラグ ---
-- PATCH /orders/{id} で product_id が変更されたら true にする。一度 true に
-- なったら false へは戻さない（担当者が一度でも手を入れた注文は「手動修正済み」）。
-- request-approval フックはこのフラグが false の注文だけを auto_match_unreviewed
-- として辞書へ反映する（true の注文は #347 の PATCH フックで既に記録済みのため
-- 二重記録しない）。
ALTER TABLE orders
  ADD COLUMN product_id_manually_corrected boolean NOT NULL DEFAULT false;

-- --- product_name_aliases / product_name_alias_history: 由来（provenance） ---
--   manual_correction     : 担当者が PATCH で明示的に product_id を修正した（#347 経路）
--   auto_match_unreviewed  : 自動マッチのまま承認依頼された（#350 経路。人間の明示確認なし）
--
-- DEFAULT 'manual_correction' はマイグレーションの安全策かつ妥当なフォールバック
-- （由来不明のエントリは手動修正である可能性が高い）。アプリコードは常に source を
-- 明示的に指定する。
ALTER TABLE product_name_aliases
  ADD COLUMN source text NOT NULL DEFAULT 'manual_correction'
  CHECK (source IN ('manual_correction', 'auto_match_unreviewed'));

ALTER TABLE product_name_alias_history
  ADD COLUMN source text NOT NULL DEFAULT 'manual_correction'
  CHECK (source IN ('manual_correction', 'auto_match_unreviewed'));
