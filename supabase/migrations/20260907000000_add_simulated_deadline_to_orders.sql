-- Issue #394-A: シミュレーションが算出した完成見込み日（シミュ納期）を永続化する。
--
-- confirmed_deadline は承認確定時（dry_run=False）にのみ書き込まれるため、
-- pending_approval / draft の行では必ず空になる。承認前の「いつ出来上がるか」を
-- 一覧・承認モーダルで見せるための列を追加する。
-- POST /orders/{id}/simulate（dry_run=True）実行時に、confirmed_deadline と
-- 同一ロジック（最終工程の終了日時 → date）で算出して保存する。
-- product_id / quantity / desired_deadline / scheduling_start_date の編集時は
-- is_scheduled とともに NULL へクリアする（stale 対策・#392 / PR #393 統合）。
--
-- RLS は既存の orders テーブルのポリシーをそのまま継承する（列追加のみ）。

ALTER TABLE orders
ADD COLUMN simulated_deadline date NULL;

COMMENT ON COLUMN orders.simulated_deadline IS
  'シミュレーション（POST /orders/{id}/simulate, dry_run=True）が算出した完成見込み日。'
  '承認前の「シミュ納期」表示に使う。product_id / quantity / desired_deadline / '
  'scheduling_start_date の編集時に is_scheduled とともに NULL クリアされる（Issue #394-A）。';
