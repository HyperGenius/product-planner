# CLAUDE.md — `__tests__/e2e/` での作業ガイドライン

このディレクトリは `@pytest.mark.e2e` を付けたテストを置く場所です。
**実際の Gmail API・Claude API・Supabase（開発環境）** に接続して、配線全体
（メール受信 → Storage保存 → テキスト抽出 → LLM抽出 → DB反映）が実際に完走する
ことを検証します。必要な環境変数は `conftest.py` 冒頭のdocstringを参照。

```bash
cd backend && pytest __tests__/e2e/ -v --run-e2e
```

## このtierを使うべき場面

- Gmail からのメール受信・ラベル操作・添付ファイルのStorage保存など、
  **実際の外部APIとの配線**が壊れていないかの確認
- Claude API による自然文/PDFからの情報抽出の**精度**そのものの検証
  （実データでの品番マッチング精度、類似品番の誤マッチ防止など）
- 上記のように、モックでは代替できない「本物の入力に対する本物の出力」を
  確かめたい場合

## このtierを使うべきでない場面

- ステータス優先順位判定・数量更新・重複スキップなど、**外部APIの出力に依存しない
  決定的なDB/RPCロジック**の検証 → [`integration/`](../integration/CLAUDE.md) で
  RPCを直接呼んで検証する方が高速・非flaky。Claude抽出結果を経由させると、
  「どのステータス・数量でRPCが呼ばれたか」を狙って再現するのが難しく、
  LLM出力の揺らぎがテストの信頼性を下げる
- 単純な分岐・入出力の対応（`_process_line_item` の action 別ログ記録など）
  → `unit/` で `db.rpc()` の戻り値をモックして検証する

## 書き方の型

- `run_id`（`uuid.uuid4().hex[:8]`）をメール件名・`source_raw` に埋め込み、
  同時実行や過去の失敗テストの残骸と衝突しないようにする
- テストデータ作成用フィクスチャは `yield` して teardown で確実に削除する
  （Gmail メッセージ・`orders`・`order_attachments`・Storage上のファイル）。
  `_cleanup_supabase()` のような共通クリーンアップ関数に極力寄せる
- 事前準備が必要なリソース（Gmailラベル、`gmail_label_tenants` 登録、
  テスト用PDFのStorageアップロード、対応する `products` レコード等）は
  フィクスチャのdocstringに明記し、揃っていなければ `pytest.skip` する
  （`e2e_config` / `pending_label_id` / `e2e_tenant_id` のパターンを参照）
- アサーションは「配線が完走したか」（`parse_status` が期待通りか、
  レコードが生成されたか）と「抽出精度」（実在製品への正しいマッチ、
  誤マッチの防止）を分けて書くと、失敗時にどちらの層の問題か切り分けやすい

## 現状の制約

- CI では自動実行されない（`--run-e2e` を明示しない限りスキップされる）ため、
  実装者が手元で環境変数を揃えて手動実行することが前提
- Claude API呼び出しが発生するため実行コストが高い。新規テスト追加時は
  「本当にこのシナリオは実APIでないと検証できないか」を先に検討すること
