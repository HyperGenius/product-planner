---
name: code-review
description: >
  このリポジトリで PR を作る前のセルフレビュー用チェックリスト。PR 作成時に自動実行される
  GitHub Copilot レビューが過去に繰り返し指摘してきた観点を、生産計画 SaaS（FastAPI + Supabase +
  Next.js、マルチテナント + RLS）向けに整理したもの。差分を書き終えたら / PR を作る直前に、
  変更した領域に該当するセクションを一通り当てる。Copilot 指摘の往復（"fix: Copilotレビュー対応" コミット）を減らすのが目的。
---

# コードレビュー観点（Copilot レビュー対策）

PR 作成時に GitHub Copilot が自動でレビューする。以下は過去の "fix: Copilotレビュー対応" コミットで
繰り返し出てきた指摘を類型化したもの。**変更した領域のセクションだけ**当てればよい。
各項目は「なぜ」も含む — 判断に迷ったら [CLAUDE.md](../../../CLAUDE.md) と [docs/features/](../../../docs/features/) が一次情報。

レビュー時の基本姿勢:

- 指摘は **具体的な再現シナリオ**（入力・状態 → 誤った出力／例外）とセットで挙げる。
- 確信度で優先度を分ける。セキュリティ（RLS / IDOR / 情報漏えい）と、ユーザー影響のあるデータ不整合を最優先。
- 「動く」だけでなく、**docs・テストが実装と一致しているか**まで見る（このリポジトリでは docs 更新も Copilot が指摘する）。

---

## 1. タイムゾーン / 日付の扱い（最頻出）

### Backend

- サーバー TZ に依存する日付ロジックを書かない。基準日は `datetime.now(JST).date()`（`date.today()` 禁止）。
- ISO 文字列の **辞書順比較で最小・最大を取らない**。`tz-aware datetime` にパースしてから比較し、JST 暦日へ変換する。
  そのロジックは純粋関数に切り出す（例: `earliest_start_date_by_order()`）とテストしやすく指摘も減る。
- 日付文字列パースは曖昧に `value[:10]` しない。`YYYY-MM-DD`（date）または ISO8601 日時のみ受理し、
  `"2026-09-10xxx"` のような不正値は弾く。

### Frontend

- `orders` の日付のみフィールド（`confirmed_deadline` / `simulated_deadline` / `desired_deadline` /
  `scheduling_start_date` / `order_date` 等、`"YYYY-MM-DD"` で時刻なし）は **必ず `parseISO()`（date-fns）** でパースする。
  `new Date("2026-09-08")` は UTC 深夜と解釈され、端末 TZ 次第で前日にズレる（「今日の納期」カウント・一覧表示日付が1日ずれる）。
- `created_at` 等の **タイムスタンプ（時刻・TZ 付き）は `new Date()` で可**。
- 過去日判定など「今日」との比較は端末ローカル TZ ではなく **JST 基準**（`jstTodayIso()` 等）で行う。
- 日付ロジックのテストは端末 TZ 非依存に書く（`new Date(y, m, d)` でローカル深夜を作る）。

---

## 2. 例外メッセージの露出（情報漏えい）

- HTTP レスポンス（4xx / 5xx の `detail`）に **例外文字列（`{exc}`）を入れない**。固定文言にする。
  詳細は `logger.exception(...)` / `logger.error(..., exc_info=True)` で **ログにのみ**残す。
- cron エンドポイントの 502/500 も同様（`routers/cron/`）。
- パスワードリセット等の認証系は、メールアドレス／テナントの存在有無が判別できるレスポンス差を作らない
  （存在しなくても一般化した 404／成功レスポンスにする）。

---

## 3. Backend ルーターの例外ハンドリング網羅

- `except ValueError` だけで済ませない。postgrest の **`APIError` も捕捉**する
  （`order_attachments` の INSERT、`.single()` など）。
- `.single()` は対象0件で例外を投げる。これを伝播させて 500 にせず、**400 / 403 / 404 に正規化**する。
  - `organization_members` 照合時の `APIError`（不正 UUID・0件）→ 403。想定外の `APIError` は 500 として再送出。
  - 参照先の添付・注文が取れない → 400。
- リポジトリの `update` / `delete` が **0件のとき 200 + null を返さない**。`count='exact'` で件数を確認し、
  0件なら `ValueError` → 呼び出し側で 404 に変換。
- 表示用スナップショット取得（`customer_name_snapshot` / `product_name_snapshot` 等）の `APIError` は
  **握りつぶして `'不明'` 等でフォールバック**し、本処理（別名 UPSERT・履歴追記・直接編集）を止めない。
- 外部パース結果の型を信用しない。`quantity` が `int | None` 以外を返したら、不整合な `order` を作らず
  `reason='invalid_quantity'` 等でログして明細をスキップするガードを入れる。

---

## 4. RLS / IDOR / マルチテナント認可（セキュリティ最優先）

- 新規テーブルには必ず `ENABLE ROW LEVEL SECURITY` と `is_tenant_member(tenant_id)` ポリシー。
- **INSERT ポリシーの `WITH CHECK` を強化**する。監査ログ・通知など、他人が書き込める余地のあるテーブルは:
  - 参照する `order_id` / `source_id` が **呼び出しテナントに実在する**こと（`EXISTS` 句）。
  - 必要なら actor のロール（`president` / `platform_admin`）も検証。
  - IDOR / 偽造耐性。`order_approval_log` / `notifications` の対応が前例。
- `source_id` 等を使ってリンク URL・相対パスを組む前に `.isdigit()` で数値検証（不正な相対パス生成の防止、二重防御）。
- **アプリコード・スクリプトで `SUPABASE_SERVICE_ROLE_KEY` を使わない**。必ずユーザー JWT。
  （cron だけは例外で `get_supabase_admin_client()`。権限チェックは `CRON_SECRET` で代替）
- 複数テナント所属ユーザー: PIN ログイン成功時などに `fetchMyTenantId` で先頭テナントを選ばない。
  **端末信頼（trusted device）に紐づく `tenant_id`** を使う。
- カスケード削除に頼らず防御的に所属再確認する（`/auth/device/*` の候補一覧・pin-login で `organization_members` を再チェック）。
- 関連レコードの後始末: メンバー削除時に `member_pins` も削除（脱退後に PIN が残らない）。

---

## 5. マイグレーション安全性

- `upsert_order_by_dedupe_key` は **最新シグネチャ（現在11引数・`p_customer_order_no` 付き、
  `20260902000000_add_customer_order_extraction_prompt.sql`）の本文をベースに**する。
  古いマイグレーションをコピーすると廃止済みの少ない引数のオーバーロードが復活し、アプリが実際に呼ぶ関数に変更が入らない。
  冒頭で旧シグネチャを `DROP FUNCTION IF EXISTS ...` してから作り直す。`supabase db reset` 後に
  `pg_proc` のオーバーロードが1つだけか確認。
- バックフィル `UPDATE` には**適切な絞り込み条件**を付ける（例: `source_type = 'email'`）。
  条件が緩いと手動作成レコードを誤って書き換える。
- データ移行マイグレーションは冒頭で `DO` ブロックで前提を検証（対象テーブルが空、既存行なし等）し、
  違反時は**分かりやすい例外で停止**する。
- カラムコメントを実挙動に合わせる（cron の巻き戻し経路 `in_progress → confirmed` 等も含める）。
- `orders_status_check` などの `CHECK` 制約・enum を実装と同期させる。

---

## 6. 型安全 / スキーマ整合

- Union 文字列型でルックアップテーブルを引くときは `Record<string, T>` ではなく
  **`Record<Order["status"], T>`** で全ケースを明示。値が増えたときに型エラーで気づける。
- Backend の Pydantic スキーマと Frontend の TypeScript interface を一致させる。
- Pydantic: 空文字を弾くなら `min_length=1`。「null（クリア）は許容、空文字は不可」等の区別を明示する。
- 表示ロジックの一元化: 検索フィルタと一覧表示で別々に `code || name` 判定をしていないか。
  共用関数（`resolveProductDisplay()` 等）にまとめる。

---

## 7. TanStack Query / データ取得（Frontend）

- Mutation の `onSuccess` で**影響する全クエリキーを `invalidateQueries`** する。
  一覧だけでなく詳細クエリ（`["orders", orderId]`）も。詳細画面から操作した直後に表示が更新されない不具合の典型。
- **二重フェッチ回避**: 共有フック（`useOrders` / `useProducts` / `useDashboardMetrics` 等）は
  親（`DashboardRouter` 等）で**1回だけ**呼び、子には props で渡す。ロール判明時の再マウントで再フェッチさせない。
- `useEffect` でのフェッチ禁止。`useQuery` / `useMutation` に統一。

---

## 8. アクセシビリティ（a11y）

- アイコンのみのボタン（コピー・再生成・パスワードリセット等）に `aria-label`。
- `disabled` ボタン + ツールチップで理由を出す場合: 外側 `span` に `role` / `aria-disabled` / `aria-label` を付け、
  内側 `Button` を `tabIndex={-1}` に。キーボード / スクリーンリーダーで「無効・理由付き」が伝わるように。

---

## 9. Frontend のエラー / ステータス処理

- API が返す **文書化済みエラーコードを個別にハンドリング**する。汎用エラー表示にフォールバックさせない
  （`routing_unconfirmed` / `no_routing` / `product_unmatched` 等はそれぞれ専用 toast）。
- 422（ValidationError）で `detail` が配列のとき、文字列へ正規化してから `ApiError` に渡す
  （でないとメッセージが `"API Request Failed"` に潰れる）。
- ステータスフィルタ等で、現在のデータに存在しない選択値になったら **"すべて" にクランプ**して復帰不能状態を防ぐ。
- バッジの色分け: `pending` を `destructive`（赤）にしない等、意味に合った中立色を使う。
- 補足文言を断定しない（`created_order_count` は updated を含まないので「全明細が重複」と言い切らず
  「新規起票なし（全明細が重複、または既存注文の更新のみ）」等）。

---

## 10. クエリ効率

- `select("*")` をやめ、レスポンス生成に必要な列のみ明示選択する。
  特に大きい列（`source_raw` 等）を無駄に取得しない。

---

## 11. 冪等性（cron）

- cron は高頻度（10〜15分間隔）で回る。処理は**冪等**に。全テナント横断で動くので `get_supabase_admin_client()` を使う。
- 新しい定期処理: `backend/app/routers/cron/` にルーター追加 → `cron/__init__.py` と `app/main.py` に登録 →
  `parse-order-pdfs-trigger/index.ts` に `callCronEndpoint(...)` を1行追加（pg_cron ジョブ新規登録は不要）。

---

## 12. docs / テストの整合

- PR ごとに [docs/features/](../../../docs/features/) の該当ドキュメントを実装に合わせて更新する
  （ステータス列挙・エラーボディ形式 `{"detail": {"error": "..."}}`・バッジ／フィルタ表・表示ロジック節）。
  実装と docs のズレは Copilot が指摘する。
- テストが依存を実際に検証しているか: `get_supabase_client` のモックを素の `MagicMock()` にせず、
  所属ありの `res.data` を明示するモックにする（依存変更でテストが壊れるように）。
- `dependency_overrides` はテスト後に確実にリセットする。
- fixture の docstring を実際の削除順・挙動に合わせる。
- **テストフィクスチャに実データ（PII）を埋め込まない**。ダミー値か匿名化した値を使う。

---

## 13. 複雑度

- ruff `C901`（複雑度）は関数を分割して解消する（`_resolve_product_id()` /
  `earliest_start_date_by_order()` のように、判定ロジックを純粋関数へ切り出す）。

---

## 14. PR / コミットの衛生

- **実データ（PII）を Issue・PR・コミットメッセージ・docs に書かない**。
  実在のメールアドレス、顧客企業名・担当者名・電話番号・住所、本番の `gmail_message_id` 等。
  → 役割で表現（「社長（社内の共通メールアカウント）」「顧客担当者」）、企業名は「顧客A社 / B社」、
  例示は `example.com` 等のダミー。
- PR の説明・コメントは**日本語**で書く（[.github/copilot-instructions.md](../../copilot-instructions.md)）。
- 着手前にブランチを切る（`feature/issue-{番号}-{概要}` / `fix/issue-{番号}-{概要}`）。

---

## CI で落ちる前に手元で確認

```bash
# Backend（リポジトリルートから。cd backend すると isort の first-party 判定がズレる）
ruff check --config=backend/pyproject.toml backend/path/to/file.py
cd backend && mypy . && pytest __tests__/unit __tests__/api

# Frontend
cd frontend && npm run lint && npx tsc --noEmit && npm run test && npm run build
```
