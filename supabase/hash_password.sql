-- pgcrypto拡張機能を有効化
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ハッシュ化した値を確認する
SELECT crypt('<your-password>', gen_salt('bf', 10));
