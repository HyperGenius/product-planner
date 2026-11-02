-- 通知ベル（notifications）の廃止 (Issue #621)
-- 既読がテナント共通・ロールで出し分けない・サイドバーの件数バッジ（Epic #553）と内容が重なる、
-- といった理由で使われていなかった。取り込みの結果は order_parse_log を元に受信メール処理結果の
-- 画面と Slack 通知（Issue #574）で確認する。過去の通知も含めてテーブルごと削除する
-- （ポリシー・インデックス・CHECK 制約はテーブルと一緒に消える）。

DROP TABLE IF EXISTS notifications;
