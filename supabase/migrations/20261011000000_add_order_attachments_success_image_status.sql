-- 画像PDF（FAX受信・スキャン）を Claude に画像として読ませて起票した受注の添付行を
-- 表す parse_status 'success_image' を追加する（Issue #520）。
-- FAX は数字の読み違いが起きうるため、受注詳細で「元ファイルで確認してください」と
-- 表示する判定に使う。
ALTER TABLE order_attachments
  DROP CONSTRAINT IF EXISTS order_attachments_parse_status_check;

ALTER TABLE order_attachments
  ADD CONSTRAINT order_attachments_parse_status_check
  CHECK (parse_status IN (
    'pending',
    'success',
    'success_image',
    'failed_encrypted',
    'failed_image',
    'failed_no_attachment'
  ));
