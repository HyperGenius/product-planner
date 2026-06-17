# 環境変数の取得・設定手順 — Gmail Cron ジョブ

Issue: #165

## 概要

Gmail ポーリング Cron ジョブの動作に必要な環境変数を、GCP Secret Manager から取得して Render / Vercel に設定するまでの手順。

---

## 必要な環境変数一覧

| 変数名 | 設定先 | 取得元 |
|---|---|---|
| `CRON_SECRET` | Render・Vercel（共通） | 自前生成 |
| `GMAIL_CLIENT_ID` | Render | GCP Secret Manager |
| `GMAIL_CLIENT_SECRET` | Render | GCP Secret Manager |
| `GMAIL_REFRESH_TOKEN` | Render | GCP Secret Manager |
| `GMAIL_QUERY_FILTER` | Render | 自前設定 |
| `GMAIL_LABEL_PROCESSED` | Render | Gmail API で確認 |
| `BACKEND_URL` | Vercel | Render のサービス URL |

---

## Step 1: CRON_SECRET を生成する

```bash
openssl rand -hex 32
```

出力された文字列をメモしておく。Render と Vercel の両方に同じ値を設定する。

---

## Step 2: Gmail 認証情報を GCP Secret Manager から取得する

#171 で Secret Manager に投入済みの値を取得する。

```bash
# プロジェクトを設定
gcloud config set project productplanner-prod

# 各シークレットを表示
gcloud secrets versions access latest --secret="gmail-oauth-client-id"
gcloud secrets versions access latest --secret="gmail-oauth-client-secret"
gcloud secrets versions access latest --secret="gmail-oauth-refresh-token"
```

各コマンドの出力が対応する環境変数の値になる。

| コマンドの `--secret` | 対応する環境変数 |
|---|---|
| `gmail-oauth-client-id` | `GMAIL_CLIENT_ID` |
| `gmail-oauth-client-secret` | `GMAIL_CLIENT_SECRET` |
| `gmail-oauth-refresh-token` | `GMAIL_REFRESH_TOKEN` |

---

## Step 3: Gmail ラベル ID を確認する

`GMAIL_LABEL_PROCESSED` には Gmail ラベルの**表示名ではなく ID**（`Label_XXXXXXXXX` 形式）を設定する必要がある。

### ラベル一覧を取得

```bash
# access_token を取得（refresh_token から）
ACCESS_TOKEN=$(curl -s -X POST https://oauth2.googleapis.com/token \
  -d "client_id=$(gcloud secrets versions access latest --secret=gmail-oauth-client-id)" \
  -d "client_secret=$(gcloud secrets versions access latest --secret=gmail-oauth-client-secret)" \
  -d "refresh_token=$(gcloud secrets versions access latest --secret=gmail-oauth-refresh-token)" \
  -d "grant_type=refresh_token" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# ラベル一覧を取得
curl -s "https://gmail.googleapis.com/gmail/v1/users/me/labels" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  | python3 -m json.tool | grep -A1 '"name"'
```

出力例:
```json
"name": "受注",
"id": "Label_1234567890123456789",
```

`"id"` の値（`Label_` から始まる文字列）が `GMAIL_LABEL_PROCESSED` に設定する値。

### ラベルがまだない場合

Gmail の設定画面（[mail.google.com → 設定 → ラベル](https://mail.google.com)）でラベルを作成してから上記コマンドを再実行する。

---

## Step 4: Render に環境変数を設定する

Render ダッシュボード → サービス選択 → **Environment** タブ で以下を設定する。

| Key | Value |
|---|---|
| `CRON_SECRET` | Step 1 で生成した値 |
| `GMAIL_CLIENT_ID` | Step 2 で取得した値 |
| `GMAIL_CLIENT_SECRET` | Step 2 で取得した値 |
| `GMAIL_REFRESH_TOKEN` | Step 2 で取得した値 |
| `GMAIL_QUERY_FILTER` | 例: `is:unread label:受注` |
| `GMAIL_LABEL_PROCESSED` | Step 3 で確認した Label ID |

設定後、**Manual Deploy** でサービスを再デプロイする。

### 動作確認

```bash
curl -s -X GET https://<render-service>.onrender.com/api/cron/gmail-poll \
  -H "Authorization: Bearer <CRON_SECRET>"
# → {"processed": 0} または {"processed": N}
```

---

## Step 5: Vercel に環境変数を設定する

Vercel ダッシュボード → プロジェクト選択 → **Settings → Environment Variables** で以下を設定する。

| Key | Value | 環境 |
|---|---|---|
| `CRON_SECRET` | Step 1 で生成した値 | Production / Preview / Development |
| `BACKEND_URL` | 例: `https://<render-service>.onrender.com` | Production / Preview |

> `BACKEND_URL` は末尾スラッシュなし。`NEXT_PUBLIC_` プレフィックスは不要（サーバーサイドのみ）。

設定後、**Redeploy** を実行して反映する。

### Cron ジョブの確認

Vercel ダッシュボード → プロジェクト → **Cron Jobs** タブから手動実行できる（Pro プラン以上）。

---

## ローカル開発での設定

`backend/.env` と `frontend/.env.local` に追記する。

```bash
# backend/.env
CRON_SECRET=<Step1の値>
GMAIL_CLIENT_ID=<Step2の値>
GMAIL_CLIENT_SECRET=<Step2の値>
GMAIL_REFRESH_TOKEN=<Step2の値>
GMAIL_QUERY_FILTER=is:unread
GMAIL_LABEL_PROCESSED=<Step3のLabel ID>
```

```bash
# frontend/.env.local
CRON_SECRET=<Step1の値>
BACKEND_URL=http://localhost:8000
```

ローカルでの動作確認:

```bash
# バックエンドを起動した状態で
curl -s http://localhost:8000/api/cron/gmail-poll \
  -H "Authorization: Bearer <CRON_SECRET>"
```

---

## 注意事項

- `CRON_SECRET` は Render と Vercel で**必ず同じ値**を設定すること
- `GMAIL_REFRESH_TOKEN` が無効化された場合は `scripts/get_gmail_refresh_token.py` を再実行して Secret Manager を更新し、Render の環境変数も差し替える（[gmail-oauth-setup.md](gmail-oauth-setup.md) 参照）
- Vercel Cron の 5 分間隔実行は **Pro プラン以上**が必要。無料プランでは 1 日 2 回まで

## 関連

- #169: GCP プロジェクト基盤（[gcp-terraform-foundation.md](gcp-terraform-foundation.md)）
- #170: Secret Manager リソース管理（[secret-manager-terraform.md](secret-manager-terraform.md)）
- #171: Gmail OAuth2 認証情報セットアップ（[gmail-oauth-setup.md](gmail-oauth-setup.md)）
- #165: Gmail ポーリング Vercel Cron ジョブ実装
