# CLAUDE.md — `frontend/e2e/` での作業ガイドライン

このディレクトリは Playwright によるブラウザ経由の E2E テストを置く場所です。
**ローカル Supabase・backend（uvicorn）・frontend（next dev）を実際に起動**した状態で、
ユーザー操作 → API → DB 反映 → 画面再描画までの一連の流れを実ブラウザで検証します。
前提条件・起動コマンド・実行方法は [README.md](README.md) を参照。

## このtierを使うべき場面

- TanStack Query のキャッシュ invalidation 漏れなど、**画面を実際に操作しないと
  気づけない不整合**（API のレスポンスは正しいのに画面に反映されない、等）
- モーダル/ダイアログを跨いだ状態遷移や、複数コンポーネント間の連携が
  意図通りに動くかの確認
- バックエンドのユニットテスト・フロントエンドの単体テスト（Vitest）・型チェックだけでは
  カバーできない「実際にクリックして初めて壊れているとわかる」類の不具合

## このtierを使うべきでない場面

- API のレスポンス形式やロジック分岐の検証 → backend の `unit/` / `api/` で
  十分高速かつ決定的に検証できる
- コンポーネント単体の見た目・props分岐、カスタムフック、純粋ロジック → Vitest +
  React Testing Library の**フロントエンド単体テスト**（`frontend/` 直下で `npm run test`、
  対象コードにコロケーション配置）を使う。詳細は
  [docs/features/frontend-unit-testing.md](../../docs/features/frontend-unit-testing.md)
- 網羅的な回帰テストとして毎回全画面を回す用途 → CI に未組み込みであり実行コストも
  高いため、「この変更で実際に画面が壊れていないか」をピンポイントで確認する用途に絞る

## 書き方の型

- テストデータの品番・製品名には `Date.now()` 等の一意なsuffixを付与し、
  同時実行や過去の失敗テストの残骸と衝突しないようにする
  （`product-routing-status.spec.ts` の `suffix` パターンを参照）
- 作成したデータは `test.afterEach` で確実に削除する。UI経由で作った以上、
  UI経由（一覧の操作メニュー → 削除）で消すのが最も確実
- ログイン直後に別ページへ `goto` すると、セッション確立前にリダイレクトされて
  ログイン画面に押し戻されることがある。`page.waitForURL(url => !url.pathname
  .startsWith("/login"))` で遷移完了を待ってから次の操作に進むこと
- 曖昧なテキストセレクタ（`text=作成` 等）はページ内の別ボタン（`新規作成` など）と
  部分一致して意図しない要素を掴むことがある。ダイアログを `getByRole("dialog")` で
  スコープし、その中で `getByRole("button", { name: "作成", exact: true })` のように
  絞り込む
- 製品コード等の一意制約があるフィールドは、空文字のまま複数レコードを
  作ろうとすると `duplicate key` エラーになる。テストでは必ず一意な値を埋める

## 画面の見た目をスクリーンショットで確認するとき（前例: `gantt-segment-bars.spec.ts`、Issue #535）

- 描画だけを見るなら、表示するデータの API は `page.route()` で固定応答にする（UI でデータを作るより速く、毎回同じ画面になる）。
  `apiClient` のクエリ付き URL は正規表現で受ける（例: `/\/production-schedules\?/`）
- 「今日」で表示範囲が決まる画面は `page.clock.setFixedTime()` と `test.use({ timezoneId: "Asia/Tokyo" })` で固定する。
  サーバー側（SSR）の時刻は固定されないのでハイドレーション不一致になり、開発用オーバーレイのバッジが写る。
  撮影前に `nextjs-portal { display: none !important; }` を `addStyleTag` で当てる
- 本番で見つかったデータの形を再現するときも、受注番号・品名・顧客名等はダミー値にする（ルートの `CLAUDE.md`「実データの取り扱い」）
- `toHaveScreenshot()` のピクセル比較は使わない（OS・フォントで差が出る・CI で回らない）。`page.screenshot()` で
  `test-results/`（gitignore 済み）に保存して PR に添付し、回帰は DOM（バーの `data-task-id` と `style.gridColumn` 等）で検証する。
  修正前を撮るときは修正対象のソースだけ `git stash push -- <paths>` して同じ spec を流す（dev サーバーが差し替わる）

## 現状の制約

- CI では自動実行されない。実装者が手元で Supabase / backend / frontend を
  起動してから `npm run test:e2e` を実行することが前提
- president ロール限定の操作（工程の確定、受注承認・却下など）を検証するテストは、
  `E2E_USER_EMAIL` / `E2E_USER_PASSWORD` で指定するユーザーが president ロールを
  持っている前提で書かれている
