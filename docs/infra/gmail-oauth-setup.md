# Gmail OAuth2 認証情報セットアップ

Issue: #171

## 概要

Gmail API アクセスに必要な OAuth2 認証情報（`client_id` / `client_secret` / `refresh_token`）を取得し、Secret Manager へ投入する手順。

> **前提**: #170 で Secret Manager シークレットリソースが作成済みであること。

---

## 手順

### 1. OAuth 同意画面の設定（GCP コンソール・手作業）

GCP コンソール > APIs & Services > OAuth 同意画面

- User Type: **Internal**（社内利用のため。External は Google 審査が必要）
- スコープ: `https://www.googleapis.com/auth/gmail.modify`

### 2. OAuth クライアント ID の作成（GCP コンソール・手作業）

GCP コンソール > APIs & Services > 認証情報 > 認証情報を作成 > OAuth クライアント ID

- アプリケーションの種類: **デスクトップアプリ**
- `credentials.json` をダウンロードし、リポジトリ外の安全な場所に保管

> `credentials.json` は `.gitignore` 対象。絶対にコミットしない。

### 3. refresh_token の取得（スクリプト実行）

```bash
pip install -r scripts/requirements.txt
python scripts/get_gmail_refresh_token.py --credentials path/to/credentials.json
```

ブラウザが自動で開き、認可後に `client_id` / `client_secret` / `refresh_token` が標準出力に表示される。

### 4. Secret Manager への値投入

```bash
echo -n "CLIENT_ID" | gcloud secrets versions add gmail-oauth-client-id --data-file=-
echo -n "CLIENT_SECRET" | gcloud secrets versions add gmail-oauth-client-secret --data-file=-
echo -n "REFRESH_TOKEN" | gcloud secrets versions add gmail-oauth-refresh-token --data-file=-
```

### 5. 確認

```bash
gcloud secrets versions access latest --secret="gmail-oauth-refresh-token"
```

---

## 注意事項

- refresh_token はアカウントのパスワード変更・長期未使用で無効化される場合がある
- 無効化された場合は手順 3〜4 を再実行して再投入する

## 関連

- #169: GCP プロジェクト基盤
- #170: Secret Manager Terraform リソース管理
- #165: Gmail ポーリング Vercel Cron ジョブ（本セットアップ完了後に実装）
- `scripts/get_gmail_refresh_token.py`
