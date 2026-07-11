# Supabase pg_cron による gmail-poll / parse-order-pdfs のスケジューリング

Issue: #261

## 目的

Gmail受注取り込みパイプラインは `GET /api/cron/gmail-poll` と `GET /api/cron/parse-order-pdfs`（いずれもRender/FastAPI）の2段階cronで構成されている（詳細は [email-order-intake.md](../features/email-order-intake.md) の「2段階Cronのスケジューリング設計」を参照）。

もともとの課題（#259）は `parse-order-pdfs` を Vercel Cron 無料（Hobby）プランの実行回数制限（1日2回まで）の下では必要な5〜15分間隔の高頻度実行ができないことだった。Supabase は既に Pro プランを利用しており pg_cron / pg_net が追加コストなしで使えるため、この2エンドポイントのスケジューリングを Vercel Cron から Supabase pg_cron に一本化した。`frontend/vercel.json` の `crons` 登録は撤去済み（`frontend/src/app/api/cron/gmail-poll/route.ts` 自体は手動デバッグ用に残しているが、自動実行のトリガーとしては使われなくなった）。

2つのエンドポイントは呼び出し方式が異なる。

```
[pg_cron（10分間隔）]
  ├─ gmail-poll-trigger ジョブ
  │    → net.http_post()（Renderへ直接）
  │      → fetch (Authorization: Bearer CRON_SECRET)
  │        → [Render: GET /api/cron/gmail-poll]
  │
  └─ parse-order-pdfs-trigger ジョブ
       → net.http_post()
         → [Supabase Edge Function: parse-order-pdfs-trigger]
           → fetch (Authorization: Bearer CRON_SECRET)
             → [Render: GET /api/cron/parse-order-pdfs]
```

`parse-order-pdfs` のみ Supabase Edge Function を経由する薄いプロキシ構成になっているのは、Issue #261 の要件（Edge Functionをスケジューラ用トリガーとして実装する）に対応したもの。`gmail-poll` は同じ理由で Edge Function を用意する必然性がなく、Render側のエンドポイント（`backend/app/routers/cron/gmail_poll.py`）が `parse-order-pdfs` と同じ `CRON_SECRET` 検証（`validate_cron_secret`）を行うため、pg_cron の `net.http_post` から直接 Render を叩けばよい。Edge Functionを増やさずシンプルに保つため、この方式を採用した。

---

## pg_cron の Terraform 管理可否の調査結果（完了条件対応）

公式 Terraform Provider [`supabase/supabase`](https://registry.terraform.io/providers/supabase/supabase/latest/docs)（2026年7月時点 v1.9.1）が提供するリソースを [GitHub上のドキュメント一覧](https://github.com/supabase/terraform-provider-supabase/tree/main/docs/resources) で確認したところ、以下の7種類のみだった。

| リソース/データソース | 用途 |
|---|---|
| `supabase_project` | プロジェクト作成 |
| `supabase_apikey`（データソース） | APIキー参照 |
| `supabase_branch` | プレビューブランチ管理 |
| `supabase_settings` | API設定（db_schema等） |
| `supabase_edge_function` | Edge Functionのデプロイ |
| `supabase_edge_function_secrets` | Edge Function Secretsの設定 |
| `supabase_third_party_auth` | サードパーティ認証連携 |

**pg_cron のジョブ（`cron.schedule()`）を管理するリソースは存在しない。** また、任意のSQLを実行できる汎用リソース（`postgresql` provider 相当のもの）もこのプロバイダには含まれていない。

**方針**: Edge Function（`parse-order-pdfs-trigger`）のデプロイのみ Terraform (`infra/terraform/supabase.tf`) で管理し、pg_cron のジョブ登録（`gmail-poll-trigger` / `parse-order-pdfs-trigger` の両方）は **手作業**（Supabase SQL Editor）で行う。将来 Terraform Provider が対応した場合は移行を検討する。

同様の理由で `supabase_edge_function_secrets` リソースも今回は使用しない。既存の `secrets.tf`（GCP Secret Manager）と同じ方針で「シークレットの値を Terraform state に平文で残さない」ことを優先し、Edge Function Secrets（`CRON_SECRET` / `BACKEND_URL`）の投入も手作業（`supabase` CLI）とする。

---

## Step 1: pg_cron / pg_net 拡張の有効化（手作業）

Supabase ダッシュボード → 対象プロジェクト → **Database → Extensions** で以下を有効化する。

- `pg_cron`
- `pg_net`

（Pro プランでは Free/Team と同様デフォルトで利用可能。有効化のみ必要）

---

## Step 2: Terraform で Edge Function をデプロイ

`parse-order-pdfs-trigger` のみが対象（`gmail-poll` は Edge Function を経由しないため Terraform 管理対象外）。

```bash
# Supabaseダッシュボード → Account → Access Tokens で発行
export SUPABASE_ACCESS_TOKEN=<取得したアクセストークン>

cd infra/terraform
terraform init -backend-config=environments/prod/backend.tfvars
terraform apply -var-file=environments/prod/terraform.tfvars
```

`terraform.tfvars` に `supabase_project_ref`（ダッシュボード → Settings → General の Reference ID）を追記しておく（`terraform.tfvars.example` 参照）。

これにより `supabase/functions/parse-order-pdfs-trigger/index.ts` が Edge Function `parse-order-pdfs-trigger` としてデプロイされる。関数のロジックは `BACKEND_URL` と `CRON_SECRET` を環境変数（Edge Function Secrets）から読み、Render の `/api/cron/parse-order-pdfs` を `Authorization: Bearer <CRON_SECRET>` 付きで fetch するだけ。

---

## Step 3: Edge Function Secrets の投入（手作業）

```bash
supabase login
supabase link --project-ref <supabase_project_ref>

supabase secrets set \
  BACKEND_URL=https://<render-service>.onrender.com \
  CRON_SECRET=<Render/Vercelと同じ値>
```

値は [env-setup-gmail-cron.md](env-setup-gmail-cron.md) で Render に設定済みの `CRON_SECRET` と同じものを使う。

確認:

```bash
supabase secrets list
```

---

## Step 4: pg_cron ジョブの登録（手作業・SQL Editor）

Supabase 公式の [Scheduling Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions) の推奨パターンに従い、URL・認証キーは平文で `cron.job` に残さず [Supabase Vault](https://supabase.com/docs/guides/database/vault) に格納してから参照する。

ダッシュボード → **SQL Editor** で以下を実行する。

```sql
-- 1. Vault に各種URL・キーを保存（一度だけ実行）

-- gmail-poll: Renderへ直接アクセスするための情報
select vault.create_secret(
  'https://<render-service>.onrender.com/api/cron/gmail-poll',
  'gmail_poll_url'
);
select vault.create_secret(
  '<Render/Vercelと同じ CRON_SECRET>',
  'render_cron_secret'
);

-- parse-order-pdfs: Supabase Edge Function経由でアクセスするための情報
select vault.create_secret(
  'https://<supabase_project_ref>.supabase.co/functions/v1/parse-order-pdfs-trigger',
  'parse_order_pdfs_trigger_url'
);
select vault.create_secret(
  '<anon or publishable key>',
  'parse_order_pdfs_trigger_apikey'
);

-- 2. pg_cron ジョブを登録（いずれも10分間隔。5〜15分の目安の中間値）

-- 2-1. gmail-poll: Renderへ直接 net.http_post（Authorization: Bearer CRON_SECRET）
select cron.schedule(
  'gmail-poll-trigger',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets
            where name = 'gmail_poll_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                      where name = 'render_cron_secret')
    )
  ) as request_id;
  $$
);

-- 2-2. parse-order-pdfs: Supabase Edge Function経由（apikeyヘッダでEdge Functionのゲートウェイ認証を通す）
select cron.schedule(
  'parse-order-pdfs-trigger',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets
            where name = 'parse_order_pdfs_trigger_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets
                 where name = 'parse_order_pdfs_trigger_apikey')
    )
  ) as request_id;
  $$
);
```

`gmail-poll-trigger` は Render の `CRON_SECRET` 認証のみを通す（Edge Functionを経由しないため `apikey` ヘッダは不要）。`parse-order-pdfs-trigger` の `apikey` ヘッダは Edge Function 自体のゲートウェイ認証（`verify_jwt`。`supabase/config.toml` の `[functions.parse-order-pdfs-trigger]` で `true` に設定済み）を通すための anon key（または publishable key）で、Render 側の `CRON_SECRET` 認証（Step 3で設定、Edge Function内部でfetch時に付与）とは別レイヤーの認証であることに注意。

2つのジョブは実行順序が前後しても問題ない設計（詳細は [email-order-intake.md](../features/email-order-intake.md) の「2段階Cronのスケジューリング設計」を参照）。

### ジョブの確認・変更・削除

```sql
-- 登録済みジョブ一覧
select * from cron.job;

-- 直近の実行履歴
select * from cron.job_run_details
  where jobname in ('gmail-poll-trigger', 'parse-order-pdfs-trigger')
  order by start_time desc limit 20;

-- 間隔を変更する場合（例: parse-order-pdfsを5分間隔に変更）
select cron.alter_job(
  (select jobid from cron.job where jobname = 'parse-order-pdfs-trigger'),
  schedule := '*/5 * * * *'
);

-- 削除する場合
select cron.unschedule('gmail-poll-trigger');
select cron.unschedule('parse-order-pdfs-trigger');
```

---

## 動作確認

`gmail-poll` は Render を直接確認する。

```bash
curl -s https://<render-service>.onrender.com/api/cron/gmail-poll \
  -H "Authorization: Bearer <CRON_SECRET>"
# → {"processed": N, "errors": 0}
```

`parse-order-pdfs` は Edge Function 経由で確認する。

```bash
curl -s https://<supabase_project_ref>.supabase.co/functions/v1/parse-order-pdfs-trigger \
  -H "apikey: <anon or publishable key>" \
  -H "Authorization: Bearer <anon or publishable key>"
# → Renderの /api/cron/parse-order-pdfs のレスポンスがそのまま返る（例: {"processed": N, "errors": 0}）
```

pg_cron 経由の実行結果は `cron.job_run_details` で確認する（Step 4参照）。

---

## 完了条件チェック

- [x] pg_cronのTerraform管理可否を調査し、方針をドキュメント化（本ドキュメントの「pg_cron の Terraform 管理可否の調査結果」）
- [x] Supabase Edge Functionが `terraform apply` でデプロイされる（`infra/terraform/supabase.tf`）
- [ ] `gmail-poll` / `parse-order-pdfs` が10分間隔で自動実行されることを本番で確認（Step 1〜4を本番Supabaseプロジェクトで実施した上で確認が必要。このPRではコード・Terraform定義・手順書までを用意し、実際の本番投入は運用担当が実施する）
- [x] `docs/infra/` 配下に構築手順のドキュメントを追加（本ファイル）
- [x] `docs/features/email-order-intake.md` の「既知のギャップ」記載を更新

---

## 関連

- #259: 2段階Cronの実行頻度に関する仕様整理・スケジューラ移行検討（[env-setup-gmail-cron.md](env-setup-gmail-cron.md)、[email-order-intake.md](../features/email-order-intake.md)）
- #169: GCP プロジェクト基盤（[gcp-terraform-foundation.md](gcp-terraform-foundation.md)）
- `supabase/functions/parse-order-pdfs-trigger/index.ts`
- `infra/terraform/supabase.tf`
- `frontend/vercel.json`（`crons` 登録を撤去）
