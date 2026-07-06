# テスト方針 (Testing Policy)

このドキュメントは、本プロジェクトにおけるテスト戦略とCI/CDの段階的な導入計画をまとめたものです。
Issue #275 での議論に基づきます。

---

## 基本方針

### 1. Unitテストは「網羅」ではなく「回帰防止」を目的とする

カバレッジ率のような指標は追わない。Unitテストを書く優先順位は以下の通り:

1. **本番環境またはE2Eテストで実際に発生したエラー** の回帰防止 (最優先)
2. `scheduler_logic.py` など、壊れた際の影響が大きいコアロジック
3. それ以外は無理に書かない

「本番/E2Eで起きたエラーをUnitテストでカバーできていたか」という観点を常に持ち、テストを後追いで厚くしていく。逆に、起きてもいない障害を想定した網羅的なテストを先回りして書くことはしない (over-engineering回避)。

### 2. 自動Issue起票は2階層に分けて考える

| 階層 | トリガー | 実現方法 |
|---|---|---|
| Layer A | CI内のE2Eテスト失敗 | GitHub Actions内で完結 (`gh issue create`)。追加のSaaS契約は不要 |
| Layer B | 本番環境のエラー | Sentry等の外部エラー監視サービスの導入が前提。新規SaaS契約になるため別途合意の上で導入する |

現状 (2026-07時点) 本番環境 (フロント: Vercel / バックエンド: Render) にエラー監視サービスは未導入。Layer Bは Phase3 で改めて検討する。

### 3. Issueとregressionテストの紐付けルール

- 本番/E2Eで発生した不具合のIssueには `incident` ラベルを付与する
- 修正PRでは、再発防止のためのテストを `regression/` ディレクトリに追加し、ファイル名にIssue番号を含める
  - backend: `backend/__tests__/regression/test_issue_{番号}_xxx.py`
  - frontend e2e: `frontend/e2e/regression/issue-{番号}.spec.ts`
- `bug_report.md` の完了条件に「回帰テストを追加したこと」を明記する
- 棚卸しは自動化せず、四半期に一度 `incident` ラベルのIssue一覧を目視で確認し、対応する `regression/` テストが存在するかを確認する程度に留める (専用の監査ツールは作らない)

---

## ロードマップ

### Phase 1 (このドキュメント作成時点で実装済み)

PRごとのゲートCIを構築する。

- `.github/workflows/ci-backend.yml`: `backend/**` の変更時に ruff / mypy / pytest (`__tests__/unit` `__tests__/api`) を実行
  - `__tests__/integration` `__tests__/e2e` は `conftest.py` の仕様上 `--run-integration` / `--run-e2e` を渡さない限り自動スキップされるため、CIでは対象外のまま素の `pytest` を実行すればよい
- `.github/workflows/ci-frontend.yml`: `frontend/**` の変更時に eslint / `tsc --noEmit` / `next build` を実行
  - この時点ではフロントエンドのUnitテスト基盤 (Vitest等) は導入しない。壊れやすいロジックが実際に出てきた時点で改めて検討する

### Phase 2 (未着手)

- Playwright E2Eテストを `main` への定期実行 (nightly) または merge契機で実行するワークフローを新設
- E2E失敗時に GitHub Actions内から `gh issue create` で `incident` `e2e-failure` ラベル付きのIssueを自動起票 (Layer A)
- `backend/__tests__/regression/` `frontend/e2e/regression/` の運用を開始

### Phase 3 (未着手)

- Sentry等のエラー監視サービスをフロント (Next.js) / バックエンド (FastAPI) 双方に導入 (要合意)
- 本番エラー発生時にWebhook経由でGitHub Issueを自動起票 (Layer B)
- Phase1/2の運用実績を踏まえ、regressionテストの紐付けルールを見直す
