-- 製品ごとの工程順序の重複を防ぐ
-- 事前に重複データがある場合は削除または修正が必要（開発環境ならリセット推奨）

ALTER TABLE process_routings
ADD CONSTRAINT process_routings_product_id_sequence_order_key 
UNIQUE (product_id, sequence_order);
