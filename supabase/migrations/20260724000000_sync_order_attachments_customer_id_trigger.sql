-- 注文の顧客変更時に order_attachments.customer_id を同期するトリガー (Issue #315)
--
-- 従来はアプリ層 (backend/app/routers/transaction/orders.py の update_order) で
-- orders の更新後に別クエリで order_attachments を更新していたため、後続の
-- 更新が失敗した場合に orders と order_attachments の customer_id が不整合の
-- まま残る可能性があった。orders.customer_id の UPDATE と同じトランザクションで
-- 実行されるトリガーに寄せることで、アトミック性を保証する。

CREATE OR REPLACE FUNCTION sync_order_attachments_customer_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  -- 1. order_id が設定済みの実添付行（注文に直接紐づく添付ファイル）を同期する
  UPDATE order_attachments
  SET customer_id = NEW.customer_id
  WHERE order_id = NEW.id;

  -- 2. メール/PDF起票の注文は、パース元の「ステージング行」
  --    (order_attachments.order_id IS NULL, orders.source_attachment_id が指す
  --    1ソース) を持つ。1ソース:N受注 (Issue #280) に対応するため、同じ
  --    source_attachment_id を持つ全ての注文の customer_id が一致した場合に
  --    限りステージング行も同期する。まだ揃っていない場合は、どちらに合わせる
  --    べきか判断できないため更新しない。
  IF NEW.source_attachment_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM orders
      WHERE source_attachment_id = NEW.source_attachment_id
        AND customer_id IS DISTINCT FROM NEW.customer_id
    ) THEN
      UPDATE order_attachments
      SET customer_id = NEW.customer_id
      WHERE id = NEW.source_attachment_id
        AND order_id IS NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_order_attachments_customer_id ON orders;

CREATE TRIGGER trg_sync_order_attachments_customer_id
AFTER UPDATE OF customer_id ON orders
FOR EACH ROW
WHEN (NEW.customer_id IS DISTINCT FROM OLD.customer_id)
EXECUTE FUNCTION sync_order_attachments_customer_id();
