# E2E テスト (Playwright)

ローカル実行専用。CI には組み込まれていない。

## 前提

以下がすべてローカルで起動していること:

```bash
supabase start
cd backend && uvicorn app.main:app --host 0.0.0.0 --port 8000
cd frontend && npm run dev
```

`E2E_USER_EMAIL` / `E2E_USER_PASSWORD` (未指定時は `backend/.env` の `TEST_USER_EMAIL` / `TEST_USER_PASS` と同じデフォルト値) で指定するテストユーザーが admin ロールを持つこと。工程の確定操作は admin のみ可能なため。

## 実行

```bash
cd frontend
npx playwright install chromium  # 初回のみ
npm run test:e2e
```
