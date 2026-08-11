-- ==========================================
-- orders.rejection_reason 追加 (Issue #325)
--
-- president が pending_approval -> draft へ差し戻す（却下する）際に、任意で
-- 入力できる却下理由を記録する。承認依頼を再送信した時点でクリアされる
-- （backend/app/routers/transaction/orders.py の request-approval エンドポイント）。
-- ==========================================

ALTER TABLE orders ADD COLUMN rejection_reason text NULL;

COMMENT ON COLUMN orders.rejection_reason IS
  '却下理由（president が pending_approval -> draft へ差し戻す際の任意入力コメント）。'
  '承認依頼の再送信時にNULLへクリアされる。';
