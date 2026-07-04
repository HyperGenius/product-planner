# 環境変数の取得・設定手順 — Gmail Cron ジョブ

Issue: #165

## 概要

Gmail ポーリング Cron ジョブの動作に必要な環境変数を、GCP Secret Manager から取得して Render / Vercel に設定するまでの手順。

---

## 必要な環境変数一覧

### Render（バックエンド）

| 変数名 | 取得元 | 備考 |
|---|---|---|
| `CRON_SECRET` | 自前生成 | Vercel と同じ値 |
| `GMAIL_CLIENT_ID` | GCP Secret Manager | — |
| `GMAIL_CLIENT_SECRET` | GCP Secret Manager | — |
| `GMAIL_REFRESH_TOKEN` | GCP Secret Manager | — |
| `GMAIL_LABEL_PREFIX_PENDING` | 自前設定 | デフォルト: `pp-pending` |
| `GMAIL_LABEL_PREFIX_PROCESSING` | 自前設定 | デフォルト: `pp-processing` |
| `GMAIL_LABEL_PREFIX_DONE` | 自前設定 | デフォルト: `pp-done` |
| `GMAIL_LABEL_PREFIX_ERROR` | 自前設定 | デフォルト: `pp-error` |
| `ANTHROPIC_API_KEY` | GCP Secret Manager | Claude メール解析用 |
| `EMAIL_EXTRACTION_MODEL` | 自前設定 | デフォルト: `claude-haiku-4-5-20251001` |
| `PRODUCT_MATCH_THRESHOLD` | 自前設定 | デフォルト: `0.3` |
| `PRODUCT_MATCH_TOP_N` | 自前設定 | デフォルト: `5` |
| `SUPABASE_SERVICE_ROLE_KEY` | GCP Secret Manager | Cron 専用。Secret Manager 管理必須 |
| `SUPABASE_URL` | Supabase ダッシュボード | — |

### Vercel（フロントエンド）

| 変数名 | 取得元 | 備考 |
|---|---|---|
| `CRON_SECRET` | 自前生成 | Render と同じ値 |
| `BACKEND_URL` | Render のサービス URL | 末尾スラッシュなし |

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

## Step 3: Anthropic API キーを Secret Manager に登録する

```bash
# APIキーを Secret Manager に保存
echo -n "<ANTHROPIC_API_KEY>" | \
  gcloud secrets create anthropic-api-key --data-file=- --project=productplanner-prod

# 既存シークレットを更新する場合
echo -n "<ANTHROPIC_API_KEY>" | \
  gcloud secrets versions add anthropic-api-key --data-file=- --project=productplanner-prod

# 確認
gcloud secrets versions access latest --secret="anthropic-api-key" --project=productplanner-prod
```

---

## Step 4: Gmail ネストラベルを作成する

処理状態管理に使う 4 種のネストラベルを Gmail に作成する。

Gmail の設定画面（[mail.google.com → 設定 → ラベル → 新しいラベルを作成](https://mail.google.com)）で以下を作成する。

| ラベル名（例） | 用途 |
|---|---|
| `pp-pending/テナントA` | Gmail フィルタが受信時に自動付与 |
| `pp-processing/テナントA` | Cron 処理開始時に自動遷移（二重処理防止） |
| `pp-done/テナントA` | 正常完了時に自動遷移 |
| `pp-error/テナントA` | 例外発生時に自動遷移 |

> テナント名部分（`テナントA`）はテナントごとに変える。プレフィックス（`pp-pending` 等）は環境変数で変更可能。

### Gmail フィルタの設定

Gmail の設定 → フィルタ → フィルタを作成 で以下を設定する。

- **From:** （受注メールの送信元ドメイン、例: `@example-customer.co.jp`）
- **ラベルを付ける:** `pp-pending/テナントA`

---

## Step 5: gmail_label_tenants テーブルにエントリを追加する

新規テナント作成時は `backend/scripts/create_tenant.py` に `--gmail-label` を指定すると自動で登録される。

```bash
python scripts/create_tenant.py \
    --company-name "テナントA" \
    --owner-email "xxx@example.com" \
    --owner-name "山田太郎" \
    --gmail-label "テナントA"
```

既存テナントへの追加登録やラベル名の変更など、上記スクリプトでカバーされないメンテナンスは
Supabase ダッシュボード → SQL Editor で直接行う（このテーブルはアプリ管理者のみが関心を持つ運用データのため、
専用の管理APIは設けていない）。

```sql
INSERT INTO gmail_label_tenants (label_name, tenant_id)
VALUES ('テナントA', '<tenant_id_uuid>');
```

`tenant_id` は `tenants` テーブルから確認する。

```sql
SELECT id, name FROM tenants;
```

登録後、Gmail アカウント側で `pp-pending/テナントA` 等のラベルを実際に作成することを忘れないこと
（`gmail_label_tenants` への登録と Gmail 上のラベル作成は別々の手作業であり、自動連携されない）。

---

## Step 6: Render に環境変数を設定する

Render ダッシュボード → サービス選択 → **Environment** タブ で以下を設定する。

| Key | Value |
|---|---|
| `CRON_SECRET` | Step 1 で生成した値 |
| `GMAIL_CLIENT_ID` | Step 2 で取得した値 |
| `GMAIL_CLIENT_SECRET` | Step 2 で取得した値 |
| `GMAIL_REFRESH_TOKEN` | Step 2 で取得した値 |
| `ANTHROPIC_API_KEY` | Step 3 で登録した値 |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase ダッシュボード → Settings → API |
| `SUPABASE_URL` | Supabase ダッシュボード → Settings → API |

以下はデフォルト値から変更する場合のみ設定する。

| Key | デフォルト | 説明 |
|---|---|---|
| `GMAIL_LABEL_PREFIX_PENDING` | `pp-pending` | — |
| `GMAIL_LABEL_PREFIX_PROCESSING` | `pp-processing` | — |
| `GMAIL_LABEL_PREFIX_DONE` | `pp-done` | — |
| `GMAIL_LABEL_PREFIX_ERROR` | `pp-error` | — |
| `EMAIL_EXTRACTION_MODEL` | `claude-haiku-4-5-20251001` | — |
| `PRODUCT_MATCH_THRESHOLD` | `0.3` | 類似度閾値（0〜1） |
| `PRODUCT_MATCH_TOP_N` | `5` | 候補表示件数上限 |

設定後、**Manual Deploy** でサービスを再デプロイする。

### 動作確認

```bash
curl -s -X GET https://<render-service>.onrender.com/api/cron/gmail-poll \
  -H "Authorization: Bearer <CRON_SECRET>"
# → {"processed": N, "errors": 0}
```

---

## Step 7: Vercel に環境変数を設定する

Vercel ダッシュボード → プロジェクト選択 → **Settings → Environment Variables** で以下を設定する。

| Key | Value | 環境 |
|---|---|---|
| `CRON_SECRET` | Step 1 で生成した値 | Production / Preview / Development |
| `BACKEND_URL` | 例: `https://<render-service>.onrender.com` | Production / Preview |

> `BACKEND_URL` は末尾スラッシュなし。`NEXT_PUBLIC_` プレフィックスは不要（サーバーサイドのみ）。

設定後、**Redeploy** を実行して反映する。

### Cron ジョブの確認

Vercel ダッシュボード → プロジェクト → **Cron Jobs** タブから手動実行できる（Pro プラン以上）。

### 既知のギャップ: parse-order-pdfs が未登録 (#259)

現在 `frontend/vercel.json` には `gmail-poll` のみ登録されており、PDF添付メールの受注確定を行う
`GET /api/cron/parse-order-pdfs` はどのスケジューラにも登録されていない。そのためPDF添付メールは
Storageへのステージング保存までしか自動化されておらず、受注として起票するには手動で
`parse-order-pdfs` を実行する必要がある（詳細な設計判断は [email-order-intake.md](../features/email-order-intake.md) の
「2段階Cronのスケジューリング設計」を参照）。

`parse-order-pdfs` は取りこぼしを避けるため5〜15分間隔程度の高頻度実行が望ましいが、
Vercel Cronは無料（Hobby）プランでは実行回数制限（1日2回まで）があり要件を満たせない。
そのため Cloud Run + Cloud Scheduler 等、Vercel Cron以外のスケジューラへの移行を検討中。

---

## ローカル開発での設定

`backend/.env` と `frontend/.env.local` に追記する。

```bash
# backend/.env
CRON_SECRET=<Step1の値>
GMAIL_CLIENT_ID=<Step2の値>
GMAIL_CLIENT_SECRET=<Step2の値>
GMAIL_REFRESH_TOKEN=<Step2の値>
ANTHROPIC_API_KEY=<Step3の値>
SUPABASE_SERVICE_ROLE_KEY=<Supabase Service Role Key>
SUPABASE_URL=<Supabase URL>
# 以下はデフォルト値から変更する場合のみ
# GMAIL_LABEL_PREFIX_PENDING=pp-pending
# EMAIL_EXTRACTION_MODEL=claude-haiku-4-5-20251001
# PRODUCT_MATCH_THRESHOLD=0.3
# PRODUCT_MATCH_TOP_N=5
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
# → {"processed": N, "errors": 0}
```

---

## 注意事項

- `CRON_SECRET` は Render と Vercel で**必ず同じ値**を設定すること
- `ANTHROPIC_API_KEY` と `SUPABASE_SERVICE_ROLE_KEY` は Secret Manager 管理必須。`.env` ファイルをリポジトリにコミットしないこと
- `GMAIL_REFRESH_TOKEN` が無効化された場合は `scripts/get_gmail_refresh_token.py` を再実行して Secret Manager を更新し、Render の環境変数も差し替える（[gmail-oauth-setup.md](gmail-oauth-setup.md) 参照）
- Vercel Cron は無料プランで 1 日 2 回まで。現在は `0 8,17 * * *`（8 時・17 時）に設定

## 関連

- #169: GCP プロジェクト基盤（[gcp-terraform-foundation.md](gcp-terraform-foundation.md)）
- #170: Secret Manager リソース管理（[secret-manager-terraform.md](secret-manager-terraform.md)）
- #171: Gmail OAuth2 認証情報セットアップ（[gmail-oauth-setup.md](gmail-oauth-setup.md)）
- #165 / #166 / #167: Gmail メール → 注文下書き自動作成パイプライン実装
- #259: 2段階Cronの実行頻度に関する仕様整理・スケジューラ移行検討
