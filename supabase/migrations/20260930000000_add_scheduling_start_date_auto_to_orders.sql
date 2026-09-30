-- Issue #477: 作業開始日（scheduling_start_date）が自動補完された値かどうかを区別するフラグ。
--
-- cron の自動起票（メール／PDF）と POST /orders/{id}/simulate は、作業開始日が未設定なら
-- 「処理日（JST）の翌日」を自動で保存する。起票から承認まで日数が空くと承認時点で
-- 過去日になり、(a) 過去日から確定スケジュールが組まれる、(b) advance-order-status cron
-- （Issue #400）が承認直後に confirmed → in_progress へ自動遷移させる、という副作用が出る。
-- そのため承認時（_confirm_single_order）は、自動補完された作業開始日が過去日なら
-- 承認日（JST）の翌日へ繰り上げる。
--
-- president / platform_admin が「起票前着手の救済」として意図的に過去日を設定した受注
-- （Issue #372）は繰り上げ対象外にしたいため、自動補完か手動設定かをこの列で区別する。
--   - 自動補完時（cron 自動シミュ・手動シミュでの補完）: true
--   - POST / PATCH /orders で作業開始日を手動設定したとき: false（DEFAULT / PATCH で明示的に戻す）
--
-- RLS は既存の orders テーブルのポリシーをそのまま継承する（列追加のみ）。

ALTER TABLE orders
ADD COLUMN scheduling_start_date_auto boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN orders.scheduling_start_date_auto IS
  'scheduling_start_date がシステムによる自動補完（処理日 JST の翌日）なら true。'
  '手動設定（POST / PATCH /orders）で false に戻る。承認時、true かつ過去日なら '
  '承認日 JST の翌日へ繰り上げる（Issue #477）。';
