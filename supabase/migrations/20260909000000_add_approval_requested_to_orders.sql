-- Issue #402: 承認待ちキューカードで「誰から・いつ」承認を頼まれたかを出すための
-- 非正規化カラムを orders に追加する。
--
-- 依頼者名は order_approval_log（action='request_approval'）経由でも取得できるが、
-- ダッシュボードの承認待ちキュー表示のたびにログテーブルを join するのを避けるため、
-- POST /orders/{id}/request-approval で orders 側に直接書き込む（アプリ層で非正規化）。
--
-- - approval_requested_at: 承認依頼を送信した日時
-- - approval_requested_by : 承認依頼を送信したユーザー（auth.users.id）
--
-- reject / withdraw-approval で draft に戻す際は両カラムを NULL クリアする（アプリ層）。
-- 次回 request-approval で必ず上書きされるため必須ではないが、draft に戻った注文へ
-- 古い依頼者・依頼日時が残らないようにする。
--
-- RLS は既存の orders テーブルのポリシーをそのまま継承する（列追加のみ）。

ALTER TABLE orders
  ADD COLUMN approval_requested_at timestamptz NULL,
  ADD COLUMN approval_requested_by uuid NULL REFERENCES auth.users(id);

COMMENT ON COLUMN orders.approval_requested_at IS
  '承認依頼（POST /orders/{id}/request-approval）を送信した日時。draft へ戻すと NULL クリア（Issue #402）。';
COMMENT ON COLUMN orders.approval_requested_by IS
  '承認依頼を送信したユーザー（auth.users.id）。非正規化。draft へ戻すと NULL クリア（Issue #402）。';

-- 既存の pending_approval 注文をバックフィルする。
-- 現在の承認待ち状態に対応するのは「最新の」request_approval 行（依頼→差し戻し→再依頼を
-- 経ている場合、経過時間の起点は直近の再依頼であるべき）なので DISTINCT ON で最新を採る。
UPDATE orders o
SET approval_requested_at = latest.created_at,
    approval_requested_by = latest.actor_user_id
FROM (
  SELECT DISTINCT ON (order_id)
    order_id, created_at, actor_user_id
  FROM order_approval_log
  WHERE action = 'request_approval'
  ORDER BY order_id, created_at DESC
) latest
WHERE o.id = latest.order_id
  AND o.status = 'pending_approval'
  AND o.approval_requested_at IS NULL;
