# GCP プロジェクト基盤 & Terraform 初期構成

Issue: #169

## 目的

Gmail OAuth 認証・Secret Manager を Terraform で管理するための GCP インフラ基盤を構築する。

---

## 作業ステップ

### Step 1: GCP プロジェクト作成（手作業）

```bash
gcloud projects create productplanner-prod --name="Product Planner Prod"
gcloud config set project productplanner-prod
```

- プロジェクト ID: `productplanner-prod`
- プロジェクト番号: `terraform.tfvars` に記載（gitignore 対象）

---

### Step 1.5: 請求先アカウントのリンク（手作業・GCS バケット作成前に必須）

GCS バケット作成には請求先アカウントのリンクが必要。

**GCP コンソールで実施:**

1. [GCP コンソール → 請求](https://console.cloud.google.com/billing) を開く
2. 「請求先アカウントを管理」→「マイプロジェクトへのリンク」
3. `productplanner-prod` を選択して請求先アカウントをリンク

**または `gcloud` CLI で実施:**

```bash
# 請求先アカウント ID を確認
gcloud billing accounts list

# プロジェクトにリンク（BILLING_ACCOUNT_ID は上記コマンドで取得した値）
gcloud billing projects link productplanner-prod \
  --billing-account=BILLING_ACCOUNT_ID
```

リンク後、再度 Step 2 に進む。

---

### Step 2: GCS バケット作成（手作業・Terraform 管理外）

Terraform state 格納用バケット。bootstrap 問題を避けるため手作業で作成する。

```bash
gsutil mb -l asia-northeast1 gs://productplanner-prod-tfstate
gsutil versioning set on gs://productplanner-prod-tfstate
```

---

### Step 3 & 4: Terraform ファイル作成・.gitignore 更新

`infra/terraform/` 配下に `main.tf` / `variables.tf` / `apis.tf` と `environments/prod/` を作成。
tfvars・state ファイルは `.gitignore` に追加済み。詳細はリポジトリを参照。

---

### Step 6: terraform init & apply

```bash
cd infra/terraform
terraform init -backend-config=environments/prod/backend.tfvars
terraform plan -var-file=environments/prod/terraform.tfvars
terraform apply -var-file=environments/prod/terraform.tfvars
```

---

## 完了条件

- [x] `terraform init` が GCS バックエンドで成功する
- [x] `terraform apply` で Gmail API・Secret Manager API が有効化される
- [x] `terraform plan` で差分ゼロになる（冪等性確認）

---

## 関連

- Issue #165: Gmail タイマートリガー Azure Function
- 後続: Secret Manager Terraform リソース管理
