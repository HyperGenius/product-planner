# infra/terraform

GCP (Cloud Run 用 API 有効化・Secret Manager) と Supabase Edge Function のデプロイを Terraform で管理する。

## 構成

```
infra/terraform/
  main.tf                        # provider 定義 (google, supabase)、backend "gcs"
  apis.tf                        # google_project_service (有効化する GCP API)
  secrets.tf                     # Secret Manager のシークレット定義
  supabase.tf                    # supabase_edge_function (parse-order-pdfs-trigger)
  variables.tf
  environments/prod/
    backend.tfvars               # GCS backend 設定
    terraform.tfvars             # 実際の値 (Git 管理外を想定する項目に注意)
    terraform.tfvars.example
```

## 基本コマンド

```bash
cd infra/terraform
terraform init -backend-config=environments/prod/backend.tfvars
terraform plan  -var-file=environments/prod/terraform.tfvars
terraform apply -var-file=environments/prod/terraform.tfvars
```

`SUPABASE_ACCESS_TOKEN` 環境変数が必要 (Supabase provider の認証)。

## 既知の不具合: Supabase Edge Function 再デプロイ時のエラー

`supabase/functions/parse-order-pdfs-trigger/index.ts` を変更して `terraform apply` すると、以下のエラーで apply が失敗することがある。

```
Error: Provider produced inconsistent result after apply
When applying changes to supabase_edge_function.parse_order_pdfs_trigger, ...
.updated_at: was cty.NumberIntVal(...), but now cty.NumberIntVal(...)
.version: was cty.NumberIntVal(2), but now cty.NumberIntVal(3)
.checksum: was cty.StringVal("..."), but now cty.StringVal("...")
```

### 原因

`supabase/supabase` Terraform Provider (v1.9.1、2026-07 時点最新) 側のバグ。
`version` / `checksum` / `updated_at` は Computed 属性だが、entrypoint 変更時にこれらを
"unknown" として扱う plan modifier が実装されていない。そのため `Update` 経路では

- plan フェーズで決め打ちされた古い値
- 実際にデプロイして Supabase から返ってきた新しい値

が食い違い、Terraform の整合性チェック (post-apply consistency check) に引っかかる。
なお、この時点で Edge Function 自体のデプロイはすでに成功しており、Terraform の state
への反映だけが失敗する。そのまま何度 `apply` してもエラーが再発し、Supabase 側の
`version` だけが無駄に上がり続ける。

参考: https://github.com/supabase/terraform-provider-supabase/releases (v1.9.1 時点で未修正)

### 対処法

`terraform destroy`(引数なし) は使わないこと — state 内の全リソース (GCP 側も含む) が
巻き込まれる。このリソース単体を Delete → Create として扱わせる `-replace` を使う。

```bash
terraform apply -var-file=environments/prod/terraform.tfvars \
  -replace="supabase_edge_function.parse_order_pdfs_trigger"
```

`-replace` なら Create 経路を通るため computed 属性は最初から unknown 扱いとなり、
上記の整合性チェックに引っかからない。

**留意点**

- Delete → Create の間、`parse-order-pdfs-trigger` 関数は一瞬存在しない状態になる
  (pg_cron からの呼び出しがこのタイミングと重なった場合はその回だけ失敗するが、
  次回のスケジュール実行で回復する)
- Function Secrets (`CRON_SECRET` / `BACKEND_URL`) はプロジェクト単位で
  `supabase secrets set` により手動管理しているため、関数の削除・再作成では失われない
- `index.ts` を変更するたびに、通常の `apply` ではなくこの `-replace` を使う運用とする
